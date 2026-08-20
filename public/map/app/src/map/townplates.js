import { map } from "./instance.js";
import { STYLES, isArtwork, onStyleChange } from "./style.js";

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
// plate is an unreadable thumbnail.
const PLATE_MIN_ZOOM = 0.5;

// One manifest per style, same idea as map/dungeonmode.js's MANIFEST_URL: bounds
// and schema are identical (town_plate.py's _publish_town_plates writes both from
// the same code), only the plate art differs.
const MANIFEST_URL = {};
MANIFEST_URL[STYLES.REALISTIC] = "assets/townplates/townplates.json";
MANIFEST_URL[STYLES.ARTWORK] = "assets/townplates-art/townplates-art.json";

// The plates paint OVER the tiles (z-index 260) but under every marker pane.
// Nothing else may claim 260.
const PLATE_PANE = "townPlatePane";

// { plates } fetched once per style and kept - a style toggle never re-downloads a
// manifest it already has. `null` means confirmed missing (map/dungeonmode.js's
// own loadManifest does the same, and warns once per style rather than per fetch).
const manifestCache = {};
const warnedMissing = {};

async function loadManifest(style) {
  if (Object.prototype.hasOwnProperty.call(manifestCache, style)) {
    return manifestCache[style];
  }
  try {
    const res = await fetch(MANIFEST_URL[style], { cache: "no-cache" });
    if (!res.ok) { throw new Error("HTTP " + res.status); }
    const manifest = await res.json();
    manifestCache[style] = (manifest.plates || []).length ? manifest : null;
  } catch (err) {
    // A deploy can ship terrain without one style's town plates - they are
    // generated (and published) separately, per style. The rest of the map is
    // unaffected, so this is a note, and it fires once per style.
    if (!warnedMissing[style]) {
      console.warn("town plates unavailable (" + style + "):", err && err.message);
      warnedMissing[style] = true;
    }
    manifestCache[style] = null;
  }
  return manifestCache[style];
}

function buildEntries(manifest) {
  return (manifest.plates || []).map((plate) => ({
    plate,
    bounds: L.latLngBounds(plate.bounds),
    overlay: null,
    shown: false
  }));
}

export async function initTownPlates() {
  // style.js now defaults `current` to ARTWORK (its own module-level
  // initialiser, set before initStyle() ever runs), so isArtwork() already
  // reads true here and this fetches assets/townplates-art/ FIRST. Falling
  // through to REALISTIC below only fires if that fetch itself fails - a
  // deploy that shipped terrain without artwork town plates. The reader's
  // actual stored preference (which may be "realistic") and a missing
  // assets/tiles-art/ manifest are both discovered later, when initStyle()
  // resolves and onStyleChange below fires switchStyle() - never a blank map
  // in between, and never the wrong style rendered first only to be swapped.
  const wantStyle = isArtwork() ? STYLES.ARTWORK : STYLES.REALISTIC;
  let manifest = await loadManifest(wantStyle);
  let activeStyleName = wantStyle;
  if (!manifest && wantStyle === STYLES.ARTWORK) {
    activeStyleName = STYLES.REALISTIC;
    manifest = await loadManifest(STYLES.REALISTIC);
  }
  if (!manifest) { return; }

  if (!map.getPane(PLATE_PANE)) {
    map.createPane(PLATE_PANE).style.zIndex = 260;
    map.getPane(PLATE_PANE).style.pointerEvents = "none";
  }

  // One entry per plate; `overlay` is built on first sight and reused after that.
  const plateLayer = L.layerGroup([], { pane: PLATE_PANE });
  let entries = buildEntries(manifest);

  function syncPlates(want) {
    // Pad the view so a plate is fetched just before it scrolls into frame.
    const view = want ? map.getBounds().pad(0.3) : null;
    for (const e of entries) {
      const show = want && view.intersects(e.bounds);
      if (show === e.shown) continue;
      if (show) {
        if (!e.overlay) {
          e.overlay = L.imageOverlay(e.plate.file, e.bounds, {
            pane: PLATE_PANE,
            interactive: false,
            className: "town-plate"
          });
        }
        e.overlay.addTo(plateLayer);
      } else if (e.overlay) {
        plateLayer.removeLayer(e.overlay);
      }
      e.shown = show;
    }
  }

  function sync() {
    const z = map.getZoom();
    const wantPlates = z >= PLATE_MIN_ZOOM;
    if (wantPlates !== map.hasLayer(plateLayer)) {
      wantPlates ? plateLayer.addTo(map) : map.removeLayer(plateLayer);
    }
    syncPlates(wantPlates);
  }
  map.on("zoomend moveend", sync);
  sync();

  // A style toggle swaps which manifest is on screen. A style with no plates of
  // its own must never blank the map: fall back to whichever set IS published,
  // silently (loadManifest warns once) - mirrors map/dungeonmode.js's
  // switchStyle/loadManifest fallback exactly.
  function switchStyle(style) {
    loadManifest(style).then(function (set) {
      const effectiveStyle = set ? style : STYLES.REALISTIC;
      const effectiveManifest = set || manifestCache[STYLES.REALISTIC];
      if (!effectiveManifest || effectiveStyle === activeStyleName) { return; }
      activeStyleName = effectiveStyle;
      plateLayer.clearLayers();
      entries = buildEntries(effectiveManifest);
      sync();
    });
  }
  onStyleChange(switchStyle);

  return { plateLayer, entries };
}
