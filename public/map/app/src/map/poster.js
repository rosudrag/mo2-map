/*
 * The poster export: the showcase artefact for the hand-drawn artwork map, and
 * the button that decides WHICH map is being exported.
 *
 * A button in the bottom-right chrome stack (enabled only while the artwork
 * style is active - src/map/style.js - because the realistic map is a data view,
 * not something meant to be framed) opens a size picker and composites an
 * offscreen <canvas> the user downloads as a PNG.
 *
 * What the picker offers depends on where the reader IS:
 *
 *   - on the surface: the current view or the whole island, at 1x or 2x, drawn
 *     from the artwork pyramid's own tiles (map/artwork-raster.js).
 *   - inside a dungeon (map/dungeonmode.js): that dungeon's plans, one level or
 *     every level plus a surface page showing its doors, composited by
 *     map/poster-dungeon.js. Exporting the terrain from underground was a bug -
 *     the mode exists to hide that terrain - so the dungeon items come first
 *     and the surface ones stay available, explicitly labelled as surface.
 *
 * The paper itself - frame, title, scale bar, compass, credit, progress pill,
 * pixel cap, download - is map/sheet.js, shared with the dungeon sheet so the
 * two products cannot drift apart.
 *
 * A missing tiles-art manifest is treated exactly like dungeonmode.js treats a
 * missing dungeonplates.json: warn and the button never appears. The artwork
 * raster is built by the offline pipeline, separately from this page's code,
 * and can legitimately lag it.
 */
import { map } from "./instance.js";
import { mapMeta } from "./meta.js";
import { STYLES, isArtwork, onStyleChange } from "./style.js";
import { openMenu } from "../ui/picker.js";
import { toast, fail } from "../ui/toast.js";
import { getMarkers } from "../poi/state.js";
import { markerVisible } from "../poi/markers.js";
import { currentDungeon } from "./dungeonmode.js";
import { exportDungeon } from "./poster-dungeon.js";
import { loadManifest, rectForIsland, rectForBounds, drawTiles } from "./artwork-raster.js";
import {
  INK, PAPER, clamp, filenameDate, fitPixelCap, drawFrame, drawTitle, drawCredit,
  pickScaleBar, drawScaleBar, drawCompass, showProgress, hideProgress, savePng
} from "./sheet.js";

// "At minimum" from the brief: two views, each at two scales. Values are also
// the openMenu item ids; slugs feed the downloaded filename.
const VIEW_OPTIONS = [
  { value: "view-1x", mode: "view", mult: 1, label: "Current view \u2014 1\u00d7", slug: "current-view-1x" },
  { value: "view-2x", mode: "view", mult: 2, label: "Current view \u2014 2\u00d7", slug: "current-view-2x" },
  { value: "island-1x", mode: "island", mult: 1, label: "Whole island \u2014 1\u00d7", slug: "whole-island-1x" },
  { value: "island-2x", mode: "island", mult: 2, label: "Whole island \u2014 2\u00d7", slug: "whole-island-2x" }
];

// ---- POI ink labels -----------------------------------------------------

/*
 * Draws every marker the live filter state currently admits (poi/markers.js's
 * own markerVisible - so a category the user hid stays hidden on the poster
 * too) that falls inside the exported rectangle. Pulled straight from the
 * already-loaded poi/state.js catalogue - no re-fetch. Which markers get a
 * NAME is not decided here: poi/markers.js already made that call when it built
 * the marker (`_poi.labelled`, the same set the live map gives a permanent
 * label), and the poster reads it. Re-deriving it was a bug twice over - first
 * as `category === "towns"`, which stopped matching when the published category
 * became `town`, then as `|| !!poi.dungeon`, which named all twelve dungeon
 * entrances and buried the dungeon under them. Everything else visible gets a
 * plain ink dot, so a whole-island poster does not drown in a thousand names.
 */
function drawMarkers(ctx, manifest, rect, destX, destY, destScale) {
  const h = manifest.canvas.height;
  getMarkers().forEach(function (marker) {
    const poi = marker._poi;
    if (!poi || !markerVisible(poi)) return;
    const c = poi.lng;
    const r = h - poi.lat;
    if (c < rect.c0 || c > rect.c1 || r < rect.r0 || r > rect.r1) return;
    const x = destX + (c - rect.c0) * destScale;
    const y = destY + (r - rect.r0) * destScale;
    const labelled = poi.labelled;
    ctx.save();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x, y, labelled ? 3.4 : 1.6, 0, Math.PI * 2);
    ctx.fill();
    if (labelled) {
      ctx.font = '600 12px "Modern Antiqua", serif';
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(poi.name, x + 6, y);
    }
    ctx.restore();
  });
}

// ---- the surface export ---------------------------------------------------

async function runExport(manifest, opt) {
  const rect = opt.mode === "island" ? rectForIsland(manifest) : rectForBounds(manifest, map.getBounds());
  const rectW = rect.c1 - rect.c0;
  const rectH = rect.r1 - rect.r0;
  if (rectW < 1 || rectH < 1) {
    toast("Nothing to export \u2014 pan the island into view first.", "warn");
    return;
  }

  const shrink = fitPixelCap(Math.round(rectW * opt.mult), Math.round(rectH * opt.mult), "export");
  const outputScale = opt.mult * shrink;
  const destW = Math.max(1, Math.round(rectW * outputScale));
  const destH = Math.max(1, Math.round(rectH * outputScale));

  const sideMargin = clamp(Math.round(Math.min(destW, destH) * 0.045), 32, 130);
  const topMargin = clamp(Math.round(sideMargin * 1.7), 54, 210);
  const bottomMargin = clamp(Math.round(sideMargin * 1.9), 60, 230);
  const totalW = destW + sideMargin * 2;
  const totalH = destH + topMargin + bottomMargin;

  const canvas = document.createElement("canvas");
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, totalW, totalH);

  const tileStats = await drawTiles(ctx, manifest, rect, sideMargin, topMargin, outputScale, function (done, total) {
    showProgress("Fetching tiles\u2026 " + done + "/" + Math.max(total, done));
  });

  drawMarkers(ctx, manifest, rect, sideMargin, topMargin, outputScale);

  // Modern Antiqua is loaded via a <link> in index.html, but text drawn to a
  // canvas before its face finishes downloading silently falls back to the
  // browser default - waiting here is what makes the title/labels reliably
  // show the right face.
  await document.fonts.ready;

  drawFrame(ctx, sideMargin, topMargin, destW, destH, clamp(Math.round(sideMargin * 0.32), 8, 30));
  drawTitle(ctx, totalW / 2, Math.round(topMargin * 0.66), totalW, mapMeta.id.toUpperCase());

  // The scale bar's length is DERIVED, never a hardcoded pixel count:
  //   pxPerMetreAtOutput = mapMeta.world.pxPerMetre * outputScale
  //   barPx              = chosen distance * pxPerMetreAtOutput
  // outputScale is destW / rectW (the chosen multiplier, reduced by any
  // pixel-cap step-down above), i.e. how many poster pixels stand for one
  // base canvas pixel. world.pxPerMetre (0.213641) is the same projection
  // constant assets/tiles/v5/tiles.json's own "projection" note carries,
  // which the artwork manifest shares by construction (identical geometry
  // per the pyramid's own contract) - so the bar always matches the actual
  // raster, not a guess.
  const bar = pickScaleBar(destW, mapMeta.world.pxPerMetre * outputScale);
  const barY = topMargin + destH + Math.round(bottomMargin * 0.3);
  drawScaleBar(ctx, sideMargin + Math.round(destW * 0.02), barY, bar.px, bar.label, 12);

  const compassR = clamp(Math.round(bottomMargin * 0.24), 14, 38);
  drawCompass(ctx, sideMargin + destW - Math.round(destW * 0.02) - compassR, barY + 6, compassR);

  drawCredit(ctx, totalW / 2, totalH - Math.round(bottomMargin * 0.2), null);

  const filename = await savePng(canvas, mapMeta.id + "-" + opt.slug + "-" + filenameDate() + ".png");
  const note = tileStats.failed > 0 ? " (" + tileStats.failed + " tiles missing/blank)" : "";
  toast("Poster saved: " + filename + note, "ok");
  // `canvas` is a local, never attached to the document or stashed anywhere
  // else - once this function returns it is simply garbage. Nothing to
  // explicitly tear down, on this path or the failure one in the caller.
}

// ---- the menu -------------------------------------------------------------

/*
 * What the picker offers right now. Rebuilt on every click, because a reader
 * enters and leaves dungeons between clicks and a stale menu would offer the
 * plans of a dungeon they already left.
 */
function menuItems(view) {
  const items = [];
  if (view) {
    const levels = view.levels.length;
    items.push({
      value: "dg-level",
      label: "This level \u2014 Level " + view.level.level + " at 0.25 m/px"
    });
    if (levels > 1) {
      items.push({
        value: "dg-all",
        label: "All " + levels + " levels + surface \u2014 one sheet"
      });
    } else {
      items.push({ value: "dg-all", label: "Level + surface \u2014 one sheet" });
    }
  }
  VIEW_OPTIONS.forEach(function (o) {
    items.push({ value: o.value, label: (view ? "Surface: " : "") + o.label });
  });
  return items;
}

async function pick(manifest, value) {
  const view = currentDungeon();
  showProgress("Rendering\u2026");
  try {
    if (value === "dg-level" || value === "dg-all") {
      if (!view) {
        toast("Left the dungeon before that render started \u2014 nothing exported.", "warn");
        return;
      }
      const out = await exportDungeon(manifest, value === "dg-level" ? "level" : "all");
      if (!out) return;
      const notes = [];
      if (out.failedPlates) notes.push(out.failedPlates + " plates missing");
      if (out.failedTiles) notes.push(out.failedTiles + " surface tiles missing/blank");
      toast(
        "Dungeon sheet saved: " + out.filename + " (" + out.size[0] + "\u00d7" + out.size[1] + ")" +
        (notes.length ? " \u2014 " + notes.join(", ") : ""),
        notes.length ? "warn" : "ok"
      );
      return;
    }
    const opt = VIEW_OPTIONS.find(function (o) { return o.value === value; });
    if (opt) await runExport(manifest, opt);
  } catch (err) {
    fail("Export failed", err);
  } finally {
    hideProgress();
  }
}

/**
 * Wires the Export button. A missing tiles-art manifest means the button
 * never appears - see the file header. Enabled state tracks style.js.
 */
export async function initPoster() {
  const manifest = await loadManifest();
  if (!manifest) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "poster-export";
  btn.className = "mg-btn";
  btn.title = "Export a framed PNG of the artwork map, or of the dungeon you are in";
  btn.textContent = "Export Poster";
  btn.disabled = !isArtwork();
  document.body.appendChild(btn);
  onStyleChange(function (style) { btn.disabled = style !== STYLES.ARTWORK; });

  btn.addEventListener("click", function () {
    if (!isArtwork()) return; // disabled attribute already guards this; belt and suspenders
    const view = currentDungeon();
    openMenu(btn, {
      title: view ? "Export " + view.label : "Export poster",
      items: menuItems(view),
      onPick: function (value) { pick(manifest, value); }
    });
  });
}
