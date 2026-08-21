/*
 * The hand-drawn artwork pyramid: a second `L.tileLayer` for the SAME canvas
 * frame as the realistic extraction (map/instance.js), built by the offline
 * pipeline and published to
 * assets/tiles-art/v2/{z}/{x}/{y}.webp + assets/tiles-art/v2/tiles.json. The
 * manifest shares tiles/v5/tiles.json's exact schema and pyramid geometry.
 *
 * Exactly one base pyramid is ever attached to the map - see map/style.js,
 * which is the only caller of setArtworkActive(). This module owns nothing
 * about WHEN to switch, only HOW: fetch the manifest once, build the layer
 * once, and swap it in for (or back out for) the realistic layer.
 *
 * A deploy can ship terrain without the artwork pyramid - it is built and
 * published separately (see the batch context) - so a missing manifest is a
 * console.warn and the map carries on with the realistic style only, exactly
 * like a missing dungeonplates.json (map/dungeonmode.js).
 */
import { map, bounds, realisticLayer } from "./instance.js";

// A version directory is IMMUTABLE, like assets/tiles/v5 - a rebuild bumps it
// (v1 -> v2 when the ground families and the town footprints landed) so a cache
// can never serve a mixture of two renderings.
const MANIFEST = "assets/tiles-art/v2/tiles.json";
const ERROR_TILE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// Memoized: the manifest is small JSON and is fetched once at boot, because it
// is what tells style.js whether there is an artwork pyramid at all. The layer
// itself is still built lazily by loadLayer() - artwork is the default style, so
// normally that happens immediately, but a reader who has stored `realistic`
// must not pay for 1,499 artwork tiles they never look at.
let manifestPromise = null;
function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST, { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) { throw new Error("HTTP " + res.status); }
        return res.json();
      })
      .catch(function (err) {
        console.warn("artwork tiles unavailable:", err && err.message);
        return null;
      });
  }
  return manifestPromise;
}

/** Resolves true once the manifest is confirmed to exist. Cheap: JSON only, no tile requests. */
export function artworkAvailable() {
  return loadManifest().then(function (manifest) { return !!manifest; });
}

let layer = null;
let layerPromise = null;
// Builds the L.tileLayer the first time it is actually needed. This is the
// one call that turns the manifest into real tile image requests, so a
// visitor who never opens the artwork style must never reach it.
function loadLayer() {
  if (!layerPromise) {
    layerPromise = loadManifest().then(function (manifest) {
      if (!manifest || !manifest.urlTemplate) { return null; }
      layer = L.tileLayer(manifest.urlTemplate, {
        tileSize: manifest.tileSize || 256,
        // Same negative-zoom window as the realistic layer (instance.js) -
        // Leaflet 1.1.1's GridLayer defaults to minZoom 0 and this canvas
        // lives at negative CRS.Simple zooms.
        minZoom: manifest.minZoom,
        maxZoom: map.getMaxZoom(),
        minNativeZoom: manifest.minZoom,
        maxNativeZoom: manifest.maxZoom,
        bounds: bounds,
        noWrap: true,
        interactive: false,
        errorTileUrl: ERROR_TILE,
        keepBuffer: 4,
        // Both layers live in Leaflet's default tilePane (z-index 200,
        // instance.js). The realistic layer takes GridLayer's implicit
        // zIndex 1; this only has to clear that to paint on top of it, while
        // staying far under every overlay pane (townPlatePane starts at 260).
        zIndex: 2
      });
      return layer;
    });
  }
  return layerPromise;
}

// The style actually wanted as of the LAST call - guards against a manifest
// fetch or layer build resolving after the user has already switched back,
// which would otherwise attach the artwork layer (or drop the realistic one)
// a moment after the user chose not to see it.
let wantArtwork = false;

/**
 * Shows exactly one base pyramid: the artwork one when `wantArtwork` is true
 * AND its manifest resolves to a real layer, the realistic one otherwise. A
 * manifest that is missing or fails to load falls back to realistic
 * silently - the same tolerance townplates.js/dungeonmode.js use.
 */
export function setArtworkActive(want) {
  wantArtwork = want;
  if (want) {
    loadLayer().then(function (art) {
      if (!art || !wantArtwork) { return; }
      if (realisticLayer && map.hasLayer(realisticLayer)) { map.removeLayer(realisticLayer); }
      if (!map.hasLayer(art)) { art.addTo(map); }
    });
  } else {
    if (layer && map.hasLayer(layer)) { map.removeLayer(layer); }
    if (realisticLayer && !map.hasLayer(realisticLayer)) { realisticLayer.addTo(map); }
  }
}
