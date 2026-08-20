/*
 * Shared machinery behind every "big raster plate drawn over the tile
 * pyramid, only while its bounds are in view" layer.
 *
 * Town plates (townplates.js) and dungeon-surface plates (surfaceplates.js)
 * are the same kind of object - a handful of multi-megabyte PNGs, one
 * manifest per map/style.js STYLE, shown only near the ground they cover -
 * so they share one implementation instead of two copies that could drift.
 * `createPlateOverlay` is parametrised by manifest URLs, pane and a class
 * name; everything else (fetch-once-per-style caching, the fallback to
 * REALISTIC when a style has no plates of its own, the view-gated show/hide,
 * the style-switch rebuild) is identical either way.
 */
import { map } from "./instance.js";
import { STYLES, isArtwork, onStyleChange } from "./style.js";

const warnedMissing = {};

/*
 * `manifestUrl`: { [STYLES.REALISTIC]: url, [STYLES.ARTWORK]: url }.
 * `pane`/`paneZIndex`: the Leaflet pane every overlay of this kind paints
 * into - reuse an existing pane (same name) to share stacking order with
 * another overlay kind, or a fresh name to own it.
 * `minZoom`: below this, the layer is removed from the map entirely rather
 * than merely hidden - these are multi-megabyte images, never nine at once.
 * `className`: CSS hook on the underlying `.leaflet-image-layer`.
 * `noun`: only for the console warning when a manifest is missing.
 *
 * Returns `{ init, loadManifest }`. `init()` resolves to `null` when neither
 * style publishes any plate, or `{ plateLayer, boundsFor(key) }` - `boundsFor`
 * reads whichever manifest is CURRENTLY on screen and tracks a style switch.
 * `loadManifest(style)` is exposed separately (cached, independent of which
 * style the live layer is showing) for callers that need one style
 * unconditionally - the dungeon poster export always draws the artwork
 * surface plate over the artwork tile pyramid, regardless of the reader's
 * live-map style.
 */
export function createPlateOverlay({ manifestUrl, pane, paneZIndex, minZoom, className, noun }) {
  const manifestCache = {};

  async function loadManifest(style) {
    if (Object.prototype.hasOwnProperty.call(manifestCache, style)) {
      return manifestCache[style];
    }
    try {
      const res = await fetch(manifestUrl[style], { cache: "no-cache" });
      if (!res.ok) { throw new Error("HTTP " + res.status); }
      const manifest = await res.json();
      manifestCache[style] = (manifest.plates || []).length ? manifest : null;
    } catch (err) {
      // A deploy can ship terrain without one style's plates of this kind -
      // they are generated (and published) separately, per style. The rest
      // of the map is unaffected, so this is a note, and it fires once per
      // style per overlay kind.
      const warnKey = noun + ":" + style;
      if (!warnedMissing[warnKey]) {
        console.warn(noun + " plates unavailable (" + style + "):", err && err.message);
        warnedMissing[warnKey] = true;
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

  async function init() {
    const wantStyle = isArtwork() ? STYLES.ARTWORK : STYLES.REALISTIC;
    let manifest = await loadManifest(wantStyle);
    let activeStyleName = wantStyle;
    if (!manifest && wantStyle === STYLES.ARTWORK) {
      activeStyleName = STYLES.REALISTIC;
      manifest = await loadManifest(STYLES.REALISTIC);
    }
    if (!manifest) { return null; }

    if (!map.getPane(pane)) {
      map.createPane(pane).style.zIndex = paneZIndex;
      map.getPane(pane).style.pointerEvents = "none";
    }

    const plateLayer = L.layerGroup([], { pane });
    let entries = buildEntries(manifest);

    function syncPlates(want) {
      // Pad the view so a plate is fetched just before it scrolls into frame.
      const view = want ? map.getBounds().pad(0.3) : null;
      for (const e of entries) {
        const show = want && view.intersects(e.bounds);
        if (show === e.shown) { continue; }
        if (show) {
          if (!e.overlay) {
            e.overlay = L.imageOverlay(e.plate.file, e.bounds, {
              pane,
              interactive: false,
              className
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
      const wantPlates = z >= minZoom;
      if (wantPlates !== map.hasLayer(plateLayer)) {
        wantPlates ? plateLayer.addTo(map) : map.removeLayer(plateLayer);
      }
      syncPlates(wantPlates);
    }
    map.on("zoomend moveend", sync);
    sync();

    // A style toggle swaps which manifest is on screen. A style with no
    // plates of its own must never blank the map: fall back to whichever set
    // IS published, silently (loadManifest warns once).
    function switchStyle(style) {
      loadManifest(style).then((set) => {
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

    return {
      plateLayer,
      boundsFor(key) {
        const e = entries.find((x) => x.plate.key === key);
        return e ? e.bounds : null;
      }
    };
  }

  return { init, loadManifest };
}
