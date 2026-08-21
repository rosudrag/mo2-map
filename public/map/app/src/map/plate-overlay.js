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
 * `minZoom`: below this, every entry is faded out and dropped - "removed from
 * the map" used to mean the whole plateLayer group was detached instantly at
 * this line, which made the fade-out below a fade-in-only effect (nothing to
 * animate once the parent group is already gone). plateLayer now stays
 * attached once added; an empty LayerGroup costs nothing, so there is no
 * multi-megabyte-image cost to leaving it there - the per-entry show/hide in
 * syncPlates is what keeps at most a handful of images loaded at once.
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
          if (e.cancelFadeOut) {
            // A fade-out was in flight (zoomed/panned back before it finished) -
            // drop the pending removal so the layer already on the map is not
            // yanked out from under the fade-in about to start.
            e.cancelFadeOut();
            e.cancelFadeOut = null;
          }
          if (!e.overlay) {
            e.overlay = L.imageOverlay(e.plate.file, e.bounds, {
              pane,
              interactive: false,
              className,
              opacity: 0
            });
          } else {
            // A reused overlay (hidden by panning away, now back in view) keeps
            // whatever opacity it last had - reset it so every appearance fades
            // in the same way a fresh one does, not just the very first.
            e.overlay.setOpacity(0);
          }
          e.overlay.addTo(plateLayer);
          // The CSS transition (townplates.css) only animates a CHANGE, so the
          // opacity:0 above has to actually be PAINTED before flipping it - one
          // rAF fires before the browser's own style/paint step for that frame,
          // so the flip has to wait for the frame AFTER that one, or the two
          // writes coalesce into a single paint and the transition never plays.
          // Same pattern the style-switch fade already relies on, now covering
          // the PLATE_MIN_ZOOM pop too: a plate popping wholesale into
          // existence at one zoom step read as a rendering glitch, not a
          // detail increase.
          requestAnimationFrame(() => requestAnimationFrame(() => e.overlay.setOpacity(1)));
        } else if (e.overlay) {
          // Symmetric with the fade in: drop to opacity 0 and only pull the
          // layer once the CSS transition actually finishes, so crossing the
          // threshold outbound reads as the same cross-fade as inbound instead
          // of an instant pop-out. `transitionend` (not a fixed setTimeout) so
          // this never drifts from whatever duration townplates.css names.
          const overlay = e.overlay;
          overlay.setOpacity(0);
          const img = overlay.getElement();
          if (img) {
            const onEnd = () => { plateLayer.removeLayer(overlay); e.cancelFadeOut = null; };
            img.addEventListener("transitionend", onEnd, { once: true });
            e.cancelFadeOut = () => img.removeEventListener("transitionend", onEnd);
          } else {
            plateLayer.removeLayer(overlay);
          }
        }
        e.shown = show;
      }
    }

    function sync() {
      const z = map.getZoom();
      const wantPlates = z >= minZoom;
      if (!map.hasLayer(plateLayer)) { plateLayer.addTo(map); }
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
