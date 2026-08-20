import { mapMeta, img } from "./meta.js";

export const bounds = L.latLngBounds(img.bounds);

export const map = L.map("map", {
  crs: L.CRS.Simple,
  minZoom: img.minZoom,
  maxZoom: img.maxZoom,
  zoomSnap: 0.25,
  zoomDelta: 0.5,
  maxBounds: bounds.pad(0.1),
  maxBoundsViscosity: 0.8,
  attributionControl: false,
  zoomControl: false
});

// The island, and the only art layer on this map: the hybrid tile pyramid.
// A missing interior tile is fully transparent by design (tiles.json), hence the
// blank errorTileUrl instead of Leaflet's broken-image behaviour.
//
// There is deliberately NO old-art layer under or over it. Two used to exist - a
// `background` imageOverlay of the whole previous map, and an `image` fallback of
// the previous island - and the background drew the old island straight over the
// pyramid as soon as its ~1 MB finished loading, so the map rendered correctly
// for about a second and then reverted. The ocean comes from the page's own CSS
// backdrop (styles/tokens.css, assets/map-bg.webp, parallaxed below), so neither
// layer was drawing anything this map needs. A deploy with no pyramid now shows
// sea and pins and says so, rather than silently serving art from another era.
// Exported so map/artwork-layer.js can hide it while the artwork pyramid is
// active - exactly one base pyramid is ever attached, see map/style.js.
export let realisticLayer = null;
if (mapMeta.tiles && mapMeta.tiles.url) {
  realisticLayer = L.tileLayer(mapMeta.tiles.url, {
    tileSize: mapMeta.tiles.tileSize || 256,
    // Leaflet 1.1.1's GridLayer defaults to minZoom 0 and this canvas lives at
    // NEGATIVE CRS.Simple zooms, so without its own window the layer computes an
    // empty tile range and renders nothing at all - container, no tiles.
    minZoom: mapMeta.tiles.minNativeZoom,
    maxZoom: img.maxZoom,
    minNativeZoom: mapMeta.tiles.minNativeZoom,
    maxNativeZoom: mapMeta.tiles.maxNativeZoom,
    bounds,
    noWrap: true,
    interactive: false,
    errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    keepBuffer: 4
  }).addTo(map);
} else {
  console.error(
    mapMeta.id + " has no tiles in registry.js: no island art will render. " +
    "Rebuild the tile pyramid with the offline pipeline and deploy assets/tiles/."
  );
}
map.setView(img.center, img.defaultZoom);
// Debug handle. The page's smoke tests (and an embedded browser console) need a
// way to drive the view - setView to a town, count what rendered - without the
// module graph being reachable from the console. Read-only by convention: nothing
// in the page reads it back.
if (typeof window !== "undefined") window.__sarducaaMap = map;

L.control.zoom({ position: "bottomright" }).addTo(map);

// Sea body bg pans/zooms with the map, but slower (parallax).
const SEA_PARALLAX = 0.56;
const SEA_BASE_SIZE = 220;
function syncSeaParallax() {
  const mapCenterOnScreen = map.latLngToContainerPoint(bounds.getCenter());
  const viewCenter = map.getSize().divideBy(2);
  const dx = (mapCenterOnScreen.x - viewCenter.x) * SEA_PARALLAX;
  const dy = (mapCenterOnScreen.y - viewCenter.y) * SEA_PARALLAX;
  const zoomScale = Math.pow(2, (map.getZoom() - img.defaultZoom) * SEA_PARALLAX);
  const size = SEA_BASE_SIZE * zoomScale;
  const pos = "calc(50% + " + dx.toFixed(1) + "px) calc(50% + " + dy.toFixed(1) + "px)";
  const sizeCss = size.toFixed(2) + "%";
  document.documentElement.style.backgroundPosition = pos;
  document.documentElement.style.backgroundSize = sizeCss;
  document.body.style.backgroundPosition = pos;
  document.body.style.backgroundSize = sizeCss;
}
map.on("move zoom", syncSeaParallax);
syncSeaParallax();
