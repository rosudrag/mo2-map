/*
 * The artwork tile pyramid as a RASTER SOURCE, for code that composites its own
 * image instead of putting a layer on the map.
 *
 * Composition fetches the pyramid's OWN tiles (assets/tiles-art/v2/) for a
 * requested rectangle and draws them by hand, rather than screenshotting
 * Leaflet's DOM: Leaflet's tile <img>s are CSS-transformed for panning/zooming
 * and partially unloaded outside the viewport (`keepBuffer`), so the DOM never
 * holds one clean raster of the area being exported - see instance.js and
 * README.md's "island tile pyramid" section. Everything here reads
 * assets/tiles-art/v2/tiles.json for geometry; it never touches
 * assets/tiles/v4/ (the realistic pyramid) at all.
 *
 * Rectangles are in the pyramid's own canvas-pixel frame, top-down like any
 * ordinary image: row 0 is the TOP. docs/map-coordinates.md is explicit that
 * "lat = Y from the bottom", so a caller converting from map coordinates flips
 * with `canvasHeight - lat` - the same flip instance.js leaves to Leaflet's
 * CRS.Simple transform, done by hand here because there is no live TileLayer
 * for the artwork pyramid to ask.
 */
import { clamp } from "./sheet.js";

export const MANIFEST_URL = "assets/tiles-art/v2/tiles.json";

// Simultaneous tile fetches. High enough that a ~650-tile whole-island export
// finishes in a reasonable number of round trips, low enough that it does not
// drown the browser's per-origin connection pool or the dev stub server.
const CONCURRENCY = 10;

/*
 * The manifest, or null when the artwork raster is not published.
 *
 * A missing tiles-art manifest is treated exactly like dungeonmode.js treats a
 * missing dungeonplates.json: warn once, and the feature that needed it stays
 * away. The artwork raster is built by the offline pipeline, separately from
 * this page's code, and can legitimately lag it.
 */
export async function loadManifest() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch (err) {
    console.warn("artwork raster unavailable:", err && err.message);
    return null;
  }
}

export function rectForIsland(manifest) {
  return { c0: 0, r0: 0, c1: manifest.canvas.width, r1: manifest.canvas.height };
}

/** `bounds` is a Leaflet LatLngBounds in the page's canvas-pixel CRS. */
export function rectForBounds(manifest, bounds) {
  const w = manifest.canvas.width;
  const h = manifest.canvas.height;
  return {
    c0: clamp(bounds.getWest(), 0, w),
    r0: clamp(h - bounds.getNorth(), 0, h),
    c1: clamp(bounds.getEast(), 0, w),
    r1: clamp(h - bounds.getSouth(), 0, h)
  };
}

function levelFor(manifest, z) {
  return manifest.levels.find(function (l) { return l.z === z; });
}

/*
 * Which tile files cover `rect`, at the finest zoom the manifest lists
 * (manifest.maxZoom - always native, per tiles.json's own contract), plus
 * where each one lands in "zoomed" pixel space (canvas pixels * 2^z).
 *
 * The pyramid's own {y} is NEGATIVE, counting up from canvas lat 0 (the
 * bottom edge) - assets/tiles/v4/tiles.json documents the same scheme this
 * one mirrors. `row` below is the ordinary top-down tile row (0 = top);
 * `row - level.rows` is the arithmetic Leaflet's CRS.Simple performs
 * internally for a live TileLayer, reproduced here because this pyramid has
 * no live layer to ask.
 */
export function planTiles(manifest, rect) {
  const z = manifest.maxZoom;
  const level = levelFor(manifest, z);
  if (!level) throw new Error("tiles-art manifest has no level for maxZoom " + z);
  const ts = manifest.tileSize;
  const s = Math.pow(2, z);
  const EPS = 1e-6;
  const zc0 = rect.c0 * s;
  const zc1 = rect.c1 * s;
  const zr0 = rect.r0 * s;
  const zr1 = rect.r1 * s;
  const colMin = clamp(Math.floor(zc0 / ts), 0, level.cols - 1);
  const colMax = clamp(Math.floor((zc1 - EPS) / ts), 0, level.cols - 1);
  const rowMin = clamp(Math.floor(zr0 / ts), 0, level.rows - 1);
  const rowMax = clamp(Math.floor((zr1 - EPS) / ts), 0, level.rows - 1);
  const plan = [];
  for (let row = rowMin; row <= rowMax; row++) {
    const y = row - level.rows;
    for (let col = colMin; col <= colMax; col++) {
      plan.push({
        url: manifest.urlTemplate.replace("{z}", z).replace("{x}", col).replace("{y}", y),
        zx: col * ts,
        zy: row * ts
      });
    }
  }
  return { ts: ts, zc0: zc0, zr0: zr0, plan: plan };
}

export async function pool(items, limit, worker) {
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  }
  const runners = [];
  for (let k = 0; k < Math.min(limit, items.length); k++) runners.push(runner());
  await Promise.all(runners);
}

/*
 * Fetches every planned tile (bounded concurrency) and draws it into `ctx`.
 *
 * `destScale` is output pixels per BASE-CANVAS pixel, but `planTiles` works in
 * the level's own pixels (canvas * 2^z), so the two differ by exactly 2^z and
 * the drawing scale has to divide it back out. Without that division a
 * whole-island export at native zoom 1 drew every tile at twice its size and
 * filled the sheet with the island's north-west quarter - the frame, the labels
 * and the scale bar were all correct around it, which is what made it look like
 * a cropping bug rather than a scale one.
 *
 * A missing file (404) is the pyramid's documented transparent-ocean case, not a
 * failure - only a total wipeout (every tile fails) aborts, so a flaky network
 * shows up as a toast instead of a poster full of holes.
 */
export async function drawTiles(ctx, manifest, rect, destX, destY, destScale, onProgress) {
  const { ts, zc0, zr0, plan } = planTiles(manifest, rect);
  const levelScale = destScale / Math.pow(2, manifest.maxZoom);
  const total = plan.length;
  let done = 0;
  let failed = 0;
  if (onProgress) onProgress(done, total);
  await pool(plan, CONCURRENCY, async function (tile) {
    try {
      const res = await fetch(tile.url, { cache: "force-cache" });
      if (res.ok) {
        const bmp = await createImageBitmap(await res.blob());
        const dx = destX + (tile.zx - zc0) * levelScale;
        const dy = destY + (tile.zy - zr0) * levelScale;
        const size = ts * levelScale;
        ctx.drawImage(bmp, dx, dy, size, size);
        bmp.close();
      } else if (res.status !== 404) {
        failed++;
      }
    } catch (err) {
      failed++;
    }
    done++;
    if (onProgress) onProgress(done, total);
  });
  if (total > 0 && failed === total) {
    throw new Error(total + " of " + total + " tile fetches failed");
  }
  return { total: total, failed: failed };
}
