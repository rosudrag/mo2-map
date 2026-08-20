import { STYLES } from "./style.js";
import { createPlateOverlay } from "./plate-overlay.js";

// Town plates: 0.25 m/px orthographic renders of each town, built from the GAME'S
// OWN placed geometry via the offline pipeline. The island
// tiles top out at 2.34 m/px and a town's buildings are actors the landscape bake
// cannot contain, so without these a town is a smudge of ground colour no matter
// how far you zoom.
//
// Each plate reaches ~380 m PAST the town and fades out over its last 110 m, so
// zooming in near a town keeps real rocks, roads, trees and shore at plate
// resolution instead of hitting a hard edge against 2.34 m/px tiles.
//
// That apron makes them big (a plate is ~1 km across, up to a few MB), so an
// overlay is created only while its own bounds are IN VIEW and dropped when it
// leaves - never nine at once. Plates only exist close in: at the island view a
// plate is an unreadable thumbnail. All of this is generic (plate-overlay.js);
// this module only names the manifests and the pane.

// One manifest per style, same idea as map/dungeonmode.js's MANIFEST_URL: bounds
// and schema are identical (town_plate.py's _publish_town_plates writes both from
// the same code), only the plate art differs.
const MANIFEST_URL = {};
MANIFEST_URL[STYLES.REALISTIC] = "assets/townplates/townplates.json";
MANIFEST_URL[STYLES.ARTWORK] = "assets/townplates-art/townplates-art.json";

// The plates paint OVER the tiles (z-index 260) but under every marker pane.
// Shared with map/surfaceplates.js: a dungeon's surface plate is the same
// kind of object drawn the same way, and the two never overlap in world
// space, so there is nothing to arbitrate by giving them separate panes.
const PLATE_PANE = "townPlatePane";
const PLATE_MIN_ZOOM = 0.5;

const overlay = createPlateOverlay({
  manifestUrl: MANIFEST_URL,
  pane: PLATE_PANE,
  paneZIndex: 260,
  minZoom: PLATE_MIN_ZOOM,
  className: "town-plate",
  noun: "town"
});

export async function initTownPlates() {
  return overlay.init();
}
