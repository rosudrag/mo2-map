import { STYLES } from "./style.js";
import { createPlateOverlay } from "./plate-overlay.js";

/*
 * The surface directly above a dungeon: 0.25 m/px orthographic renders of
 * its entrances and their surroundings, built from the game's own placed
 * geometry (auxilliary/mo2-terrain-map/tools/dungeon_plate.py:
 * render_dungeon_surface, town_plate.py's own extraction/rasterising
 * machinery pointed at a dungeon's entrance packages instead of a town).
 *
 * Before these existed, a dungeon entrance sat on bare island tile - 2.34 m/px
 * in the artwork style, 0.585 m/px in the realistic style - the one place on
 * the map with no high-res plate at all, since a town's buildings are the
 * only other thing outside the landscape bake.
 * Drawn exactly like map/townplates.js (same pane, same view-gating, same
 * per-style manifest with a REALISTIC fallback): plate-overlay.js is the
 * shared implementation, this module only names the manifests.
 */
const MANIFEST_URL = {};
MANIFEST_URL[STYLES.REALISTIC] = "assets/surfaceplates/surfaceplates.json";
MANIFEST_URL[STYLES.ARTWORK] = "assets/surfaceplates-art/surfaceplates-art.json";

// Same pane as the town plates (townplates.js): both are "high-res ground
// truth over the tile pyramid, under every marker pane", and a town and a
// dungeon entrance never occupy the same ground, so there is nothing to
// arbitrate by sharing it.
const PLATE_PANE = "townPlatePane";
const PLATE_MIN_ZOOM = 0.5;

const overlay = createPlateOverlay({
  manifestUrl: MANIFEST_URL,
  pane: PLATE_PANE,
  paneZIndex: 260,
  minZoom: PLATE_MIN_ZOOM,
  className: "surface-plate",
  noun: "dungeon surface"
});

let live = null;

export async function initSurfacePlates() {
  live = await overlay.init();
  return live;
}

/* The live layer's bounds for one dungeon key, or null - no plate published,
 * or initSurfacePlates() hasn't resolved (or found nothing to show) yet.
 * dungeonmode.js's step-out reads this to fit the high-res plate instead of
 * a fixed zoom guess. */
export function surfaceBoundsFor(key) {
  return live ? live.boundsFor(key) : null;
}

/* One dungeon's plate record - `{ file, bounds, metresPerPx, size,
 * entrances }` or null - for an EXPLICIT style, independent of whichever
 * style the live layer is currently showing. map/poster-dungeon.js's export
 * always draws the artwork surface plate over the artwork tile pyramid
 * (matching how it already always draws the artwork tiles, never the live
 * map's own style), so it asks for STYLES.ARTWORK regardless of `live`. */
export async function surfacePlateFor(key, style) {
  const manifest = await overlay.loadManifest(style);
  if (!manifest) { return null; }
  return (manifest.plates || []).find((p) => p.key === key) || null;
}
