// The map registry: one declarative description per continent, keyed by map
// id. This id is also the `maps` table's namespace for everything that is
// not the surface (migration 020) - a dungeon level on a continent is
// "<mapId>/<dungeonKey>/<level>" - and it is the path segment that
// continent's own directory is named after (public/map/<mapId>/).
//
// Leaflet layers use CRS.Simple: lat = Y from bottom, lng = X from left.
//
// Sarducaa is the only continent with any art published here. Myrland and
// Haven are real, registered entries with no `image`/`tiles`/`world`/
// `layers` block - not zero-filled, not fake defaults - because there is
// nothing to show yet. Each has its own standalone page
// (public/map/<mapId>/index.html) that says so directly and never loads the
// app bundle at all; see the map switcher (map/switcher.js) for how that
// page reads `unpublishedReason` below.
export const MAPS = {
  sarducaa: {
    id: "sarducaa",
    title: "Sarducaa Map",
    published: true,
    sortOrder: 0,
    // The island is the `tiles` pyramid and NOTHING ELSE - no layer of the
    // game's own map art remains. A `background` imageOverlay of the whole
    // previous map and an `image` fallback of the previous island both lived
    // here until 2026-08-18, and the background drew the old island over the
    // pyramid a second after load, which read as the new map reverting. The
    // ocean is the page's CSS backdrop (styles/tokens.css).
    //
    // The canvas itself: pixel size, zoom window and opening view. `world`
    // below is calibrated against exactly this pixel frame, so these numbers
    // move only when the canvas is re-cut - not when the map inside it is
    // rebuilt.
    image: {
      width: 5120,
      height: 3579,
      bounds: [[0, 0], [3579, 5120]],
      minZoom: -3,
      maxZoom: 4,
      defaultZoom: -1,
      center: [1789.5, 2560]
    },
    // OUR OWN extraction of the shipped game data: the engine's per-tile
    // ground colour bake, our hillshade and our water, at 2.34 m per pixel
    // (built by the offline pipeline). Placed with the
    // `world` constants below rather than fitted to anything, so terrain and
    // pins share one transform. Zoom 0 is one canvas pixel per tile pixel;
    // tile y is negative, counting up from lat 0. v1 was a composite that
    // took its colour from the game's art and therefore looked like it -
    // deleted, not kept as a fallback.
    tiles: {
      url: "assets/tiles/v4/{z}/{x}/{y}.webp",
      tileSize: 256,
      minNativeZoom: -5,
      maxNativeZoom: 1
    },
    // Which optional layers this continent has published, for anything that
    // wants to know without probing a manifest (e.g. a future map switcher).
    // style.js/townplates.js/dungeonmode.js still probe their own manifests
    // to init - this is a declared capability, not a substitute for that.
    layers: { artwork: true, townplates: true, dungeonplates: true },
    // UE world metres -> this canvas. Axis-aligned, uniform scale, no rotation:
    //   lng = pxPerMetre * worldX + originLng
    //   lat = originLat - pxPerMetre * worldY      (map lat runs opposite world Y)
    // `kind: "fitted"` means these numbers were DERIVED by least-squares
    // regression against in-game anchors, not chosen to fit a canvas we
    // defined ourselves - see docs/map-coordinates.md for what "fitted" vs
    // "defined" means and why the distinction matters. Scale fitted
    // 2026-07-28 over the anchors below (in-game bookmark world position vs.
    // the same place clicked on this canvas), and independently confirmed to
    // 0.3% by registering the previous 2884x2916 art onto this canvas and
    // re-fitting the WA town pins.
    //
    // originLat corrected 2026-08-10 by -42.7282 px (= -200 m at this scale),
    // from 1751.8418. In-game observation: the live YOU blip and presence
    // dots rendered ~200 m NORTH of where the player actually stood. The
    // clicked anchors cannot see that error - they are the thing that was
    // wrong - so this is a measured origin correction, not a re-fit. The
    // anchor table is kept as the record of the scale fit and now carries
    // that same 42.7 px in its lat residuals; a proper re-fit
    // (docs/map-coordinates.md) supersedes it.
    //
    // RE-FIT AFTER ANY MAP ART CHANGE - the constants describe THIS image.
    world: {
      kind: "fitted",
      fittedAt: "2026-07-28",
      pxPerMetre: 0.213641,
      originLng: 1783.4447,
      originLat: 1709.1136,
      anchors: [
        { name: "Ben Jedda", worldX: 2946.4157, worldY: -1938.3203, lat: 2176.0, lng: 2427.0 },
        { name: "Bedia", worldX: 3202.2903, worldY: -3816.5842, lat: 2554.6, lng: 2460.5 },
        { name: "Aur", worldX: 989.7323, worldY: -6545.9641, lat: 3152.9, lng: 1987.9 }
      ]
    }
  },
  myrland: {
    id: "myrland",
    title: "Myrland Map",
    published: false,
    sortOrder: 1,
    // The offline pipeline has extracted and
    // tiled Myrland's terrain, but none of it is published into this repo:
    // no canvas registration, no world<->canvas transform, no anchors, no
    // POIs, no plates. Worded for whoever reads it on the page itself, not
    // for us - see public/map/myrland/index.html.
    unpublishedReason: "Myrland's terrain has been mapped, but this map isn't ready to show it yet."
  },
  haven: {
    id: "haven",
    title: "Haven Map",
    published: false,
    sortOrder: 2,
    // The offline pipeline has never indexed or stitched Haven - there is
    // nothing extracted to publish, unlike Myrland above.
    unpublishedReason: "Haven hasn't been mapped yet \u2014 there's nothing to show."
  }
};
