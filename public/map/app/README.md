# Mortal Online 2 map — shared application

This is the one application shared by every continent's page. A continent is
a thin directory (`public/map/<mapId>/`) holding only `index.html`,
`static.html` and its own tile/plate assets under `assets/`; everything
here — `src/`, `vendor/`, the built `dist/`, and the UI-chrome `assets/`
(Tabler icons, game icons, the sea backdrop) — is loaded by every one of
them via `../app/...`. The declarative description of each continent
(canvas size, tile pyramid, world↔canvas transform, published state) lives
in [`../registry.js`](../registry.js), not here — see `map/meta.js` and
`map/current.js` for how a page picks its own entry out of it.

Static files are served as-is (`.htaccess` only rewrites missing files to
`index.php`); document root is `public/`.

Everything below this point describes the ONE continent that has anything
published — Sarducaa. See [`../sarducaa/README.md`](../sarducaa/README.md)
for that continent's own served-at URL and editing source-of-truth.
Myrland and Haven are registered but unpublished — see their entries in
`../registry.js` and their own standalone pages
(`../myrland/index.html`, `../haven/index.html`).

## Data

Paths below are relative to `public/map/sarducaa/` unless stated otherwise.

- Map image config: `../registry.js`'s `sarducaa` entry (`MAPS.sarducaa` — image bounds/zoom + the `world` calibration block)
- World→pixel projection: that same entry's `world` block, the ONLY copy of the constants — see [../../../docs/map-coordinates.md](../../../docs/map-coordinates.md). Re-fit it whenever the map art changes.
- Page sea backdrop (shared, not Sarducaa-specific): CSS on `body` → `../app/assets/map-bg.webp`
- Map layers: `../registry.js`'s `sarducaa.tiles` — `tiles` = the zoomable island pyramid at
  `assets/tiles/v4/{z}/{x}/{y}.webp`, and that is the ONLY art layer. `image` is now just the
  canvas descriptor (pixel size, zoom window, opening view) and carries no file.
- **No old-art layer, and no old art in `assets/`.** A `background` imageOverlay of the whole
  previous map and an `image` fallback of the previous island both existed until 2026-08-18; the
  background drew the old island over the pyramid once its ~1 MB loaded, so the page looked right
  for a second and then reverted. The ocean is the CSS backdrop above, so neither drew anything
  the map needs. Deleted with them: `map-overlay.{webp,jpg}`, `map-overlay_2.webp`,
  `map-overlay_2_older.{png,webp}`, `sarducaa.jpeg`, `map-bg.png` (unused twin of the `.webp`) —
  about 75 MB. The art that fed the hybrid lives with the offline pipeline that
  consumes it, not duplicated in this repo.
- **Island tile pyramid** (`assets/tiles/v4/`, 906 tiles, committed — deploy is a plain
  rsync). It is OUR OWN extraction of the shipped game data — the engine's per-tile ground
  colour bake, hillshade and water, at 2.34 m/px — with two regions patched from the
  mortalonline2map.com render: the cook's missing-components gap (7.4% of the island) and
  the crater area east of Ben Jedda (17.4%), and five painted towns (0.28%) whose buildings
  are actors the ground bake cannot contain - each re-anchored to our tone and flagged in
  provenance. Built by the offline pipeline. It is placed with the `world`
  calibration below applied directly, so terrain
  and every pixel-stored community pin share one transform. v1 (art composite), v2 (pure extraction) and v3 are deleted; nothing falls back to them.
  - Zoom 0 is one canvas pixel per tile pixel; the pyramid runs z −5..1 and Leaflet upscales
    beyond z1 (`maxNativeZoom`).
  - Tile **y is negative** and counts upwards from canvas lat 0 — that is where `CRS.Simple`
    anchors its grid. A missing tile file is fully transparent by design, hence the blank
    `errorTileUrl` in `src/map/instance.js`.
  - It uses Leaflet's own `tilePane`. Nothing else may be given z-index 200: the deleted
    `mapBg` pane was exactly that, created later, and it painted over the tiles.
  - Rebuilding the pyramid: bump the version directory (`tiles … v5`) and the `tiles.url` in
    `../registry.js`'s `sarducaa.tiles` together, so caches cannot serve a mixture — a version
    directory is immutable.
- **Town plates** (`assets/townplates/`, all 9 Sarducaa cities, ~11 MB total): 0.25 m/px
  orthographic renders built from the GAME'S own placed meshes
  (built by the offline pipeline), drawn over the tiles from zoom 0.5 in
  pane `townPlatePane` (z-index 260). Buildings are actors, so the landscape bake cannot
  contain them - without these a town is a smudge of ground colour at every zoom.
  - Each plate reaches **380 m past the town** (real cliffs, roads, trees, shore from the
    landscape levels) and ramps to transparent over its last 130 m, so there is no hard edge
    where plate meets tile. That makes them ~1 km wide and up to 2.9 MB, so an overlay is
    created only while its bounds are **in view** and dropped when it leaves - never nine at
    once. Verified: 0 loaded at island zoom, 1 at a town, 0 after panning away.
  - `townplates.json` is the manifest: canvas `bounds` per plate, nothing else. It used to
    also carry the 125 town POIs as a baked `pois` array, drawn as fixed circle badges in a
    `townPoiPane` with no filter, search or click-through. Those POIs were promoted to real
    `map_markers` rows (`migrations/019_place_gamefile_pois.sql`) and the badge layer was
    deleted outright - town POIs are ordinary pins now, filterable and searchable like every
    other marker, and the plate layer above is otherwise unchanged.
  - `window.__sarducaaMap` is a debug handle for smoke tests (set in `src/map/instance.js`).
  - **Two styles, same bounds.** `assets/townplates-art/` holds a hand-inked town-plan
    variant of every plate (9 towns, 3.3 MB total vs ~11 MB realistic) - parchment paper for
    courtyards, streets and the apron, iron-gall ink for building walls traced from the
    coverage mask's own gradient (no wall mesh is ever rasterised), hatch density instead of
    the realistic plate's brightness ramp for building height. `src/map/townplates.js` picks
    `townplates.json` or `townplates-art.json` by the active style and rebuilds its overlays
    on `onStyleChange`, exactly like `dungeonmode.js` does for dungeon plates below - falling
    back to the realistic set (one console warning) if the artwork manifest is missing, never
    a blank map.
- **Dungeon map** (`assets/dungeonplates/`, 4 dungeons / 9 level plates, 2.9 MB total,
  108-625 KB each): 0.25 m/px orthographic renders of dungeon interiors, cut 6 m above each
  level's floor, built from the GAME'S own placed meshes
  (built by the offline pipeline). Bounds are the same canvas lat/lng
  frame as the tiles, so a level plate sits exactly under the terrain its entrance is beneath
  and the entrance pins land on their own doorways.
  - **It is a MODE you enter, not a layer you find.** The first cut was zoom-gated: pan into a
    dungeon's bounds, zoom past 0.5, notice a corner control, flip a toggle - four steps of the
    user doing the map's job. Now a dungeon is a destination. Its pin is on the surface map at
    any zoom, labelled like a town; its popup offers **Open dungeon map**; and a **Dungeons**
    button (bottom-right, above the zoom control, never hidden) lists all four.
  - Entering flies the view to the level's bounds (`fitBounds`), swaps the surface out and
    shows a bar across the top: dungeon name, one button per level with its elevation range,
    and **Leave**. `Escape` leaves too, and leaving restores the exact centre and zoom you came
    from - captured before the fly-in, so a visit undoes itself.
  - **The surface is replaced, not layered over.** `in-dungeon` on `<body>` and the map
    container takes `#map` to near-black, the tile pane to 12% opacity with
    `grayscale(.8) brightness(.45)`, and hides `townPlatePane` outright (a 0.25 m/px town plate
    is the brightest thing competing with an interior). Two measured mistakes are baked into
    those numbers: as a plain overlay the lit terrain surrounded the plate and came through the
    10% backdrop the renderer leaves, and dimming alone composited the desert against
    `#map { background: transparent }` (tokens.css) as pale teal daylight.
  - Exactly ONE interior `imageOverlay` is ever in the map, in `dungeonPlatePane` (z-index 265
    - above `townPlatePane`'s 260, below every marker pane, so pins stay clickable over a
    floor plan). The "megabyte layers must be view-gated" rule (town plates above) is satisfied
    structurally: a mode is one dungeon and one level, and it exists only while the user is
    deliberately inside it, so panning within a dungeon does not churn the plate.
  - Switching level keeps the view unless the new level is somewhere else entirely - refitting
    on every switch throws the reader out of the room they were reading.
  - Verified in a browser: 1 overlay on enter (`argkepher_l1`), 1 (never 2) after switching to
    level 2, `#map` background `rgb(10, 9, 16)` and tiles at 0.12 while inside, and on `Escape`
    0 overlays with tiles back to 1 and the view back at its original centre/zoom.
  - A dungeon and its entrances are never clustered away (`landmarks` is a clusterable
    category, and at island zoom they used to vanish into a bubble with 90 other landmarks);
    the dungeon itself carries a town-style label, its entrances do not, because four labels
    inside 500 m is a pile rather than a map. Boss rooms stay ordinary pins - they are inside.
- **Artwork rendering** (`assets/tiles-art/v2/`, 1,499 tiles, ~9 MB) is the **DEFAULT**
  base map; the realistic pyramid above is one click away and is also the fallback when
  this manifest is missing. The SAME island drawn as period cartography - parchment,
  iron-gall ink, a hypsometric glaze, contours at 40 m, hachures on every slope, ground
  families (sand / rock / vegetation / ash) read off the game's own baked ground colour,
  town walls and blocks inked from the towns' own placed geometry, and symbols standing
  on the game's own instances,
  built by the offline pipeline.
  - A version directory is immutable: `v1` was the first cut, `v2` added the ground
    families and the town footprints. Bump the directory and `artwork-layer.js`'s
    `MANIFEST` together, exactly as for `tiles/v4`.
  Same canvas frame, same affine, same pyramid geometry as `assets/tiles/v4`, so the two are
  one map in two hands and every pin lands in both.
  - **A style, not a layer.** `src/map/style.js` owns which base pyramid is attached and
    persists the choice in `localStorage` (`mo2map.<mapId>.style`, per continent). **The default is artwork**,
    and it lives in the code rather than in the absence of a key, so a first visit and a
    cleared browser agree; only an explicit stored `realistic` switches back.
    `src/map/artwork-layer.js` still builds the artwork `L.tileLayer` lazily - normally
    that happens immediately, but a reader who stored `realistic` must not pay for 1,499
    tiles they never look at - and exactly one base pyramid is on the map at any time. The
    button is the top of the bottom-right stack and is **not created at all** when the
    manifest is absent: with no artwork on disk the realistic map is all there is, and a
    dead control is worse than none.
  - While artwork is active `<body>` carries `style-artwork` and the map container `artwork`;
    `styles/artwork.css` warms the chrome by overriding the same custom properties
    `tokens.css` defines, so no panel's layout changes.
  - Every artwork tile is **opaque** - this map draws its own sea rather than letting the
    page's backdrop through - so unlike the realistic pyramid a missing tile file is a fault,
    not a transparent hole.
  - Dungeon plans follow the style: `assets/dungeonplates-art/` holds an inked floor-plan
    variant of every level plate, and `dungeonmode.js` picks the manifest by the active style,
    falling back to the realistic plates (with one console warning) if the art set is missing.
- **Poster export** (`src/map/poster.js`): while artwork is active, an Export Poster button
  composites the artwork pyramid's OWN tiles for the current view or the whole island, at 1x
  or 2x, and draws a cartouche over it - double rule, title, compass, derived scale bar,
  visible pin labels, provenance line - then downloads a PNG.
  - It never screenshots Leaflet: the live tiles are CSS-transformed and partially unloaded,
    so the DOM has no clean raster of the exported area. Tile plans are in the level's own
    pixels (canvas x 2^z) and the draw scale divides that back out; without the division a
    whole-island export at native zoom 1 drew every tile twice its size and filled the sheet
    with the island's north-west quarter, frame and labels correct around it.
  - Output is capped at 45 MP and steps down uniformly with a toast rather than refusing or
  hanging the tab; the offline pipeline has a full-resolution twin export.
  - **Inside a dungeon it exports the DUNGEON**, not the terrain the mode is hiding
    (`src/map/poster-dungeon.js`): either the open level at its own native 0.25 m/px, or
    every level plus a surface page, on one sheet.
    - Level panels share ONE rectangle and ONE scale - the union of every level's bounds
      and every entrance - so a room on Level 1 sits on the sheet directly above the same
      ground on Level 2. Each level's own extent is the dashed rule inside its panel.
    - Entrances are numbered from `meta.poi_id` (`…entrance.02` -> "2"), never from the
      pin's name: the community catalogue names two of Sarducaa's doors after the dungeon
      ("Halls of Kepher"). The same number appears on every panel and in the key; a door
      that belongs to another storey keeps its own position and gets a hollow ring.
    - Which doors and rooms are on which level is the RECORD's own `map`, never geometry
      (see **Maps** below).
    - The surface panel is the artwork pyramid enlarged to the panel box, and its caption
      prints BOTH resolutions (`0.96 m/px, from 2.34 m/px tiles`) because 2.34 m/px is the
      finest surface raster **published**, so anything sharper on this page would be an
      upscale sold as a survey. It is not a limit of the game data: all 12 entrance
      packages hold placed geometry (85-3,397 instances each, `poihunt Sarducaa/Dungeons`),
      so a 0.25 m/px entrance plate per door is renderable - it needs a `dungeon_plate.py`
      pass for above-ground exteriors and a published plate set, which this export does not
      have and does not fake.
    - Every panel carries its OWN scale bar: one bar for a sheet whose surface panel is a
      different scale from its level panels would be wrong on at least one panel.
- Pins: a committed snapshot at `data/static/pins.json` (`sources/static/pins.js`, `data.js`), read-only, with taxonomy derived from the rows themselves. A missing or broken snapshot no longer hides the YOU blip — the page boots an empty catalogue instead.
- Icons: Tabler outline SVGs used by categories at `assets/tabler/` (committed). Full Tabler tree under `../tabler-icons-3.45.0/` is optional/local only.

- **Maps** (`src/map/active-map.js`, `maps` table): the island's surface is one map and
  every rendered dungeon LEVEL is another (`sarducaa`, `sarducaa/argkepher/2`, …).
  Markers, bookmarks and discoveries each state the map they are on and the page shows
  the records of the map you are looking at; `dungeonmode.js` switches it on enter /
  level change / leave, and every layer rebuilds from the catalogue it already has, with
  no refetch. A record with no `map` is a surface record, which is exactly what every
  row written before migration 020 is.
  - This replaced inferring a floor from coordinates, which cannot work: a dungeon's
    levels are stacked storeys whose outlines overlap almost completely, so a bounds
    test put all three of Yel Keskar's surface doors and the boss room from the bottom
    of the dungeon onto every level.
  - A pin created while a dungeon level is open belongs to that level (the private
    repo's live pins source stamps `activeMapId()` at create time), so nothing has to be re-filed afterwards.
  - Seeded content per level comes from the game's own files via the offline
    pipeline: the inside face of each of the
    12 doors, the 4 boss rooms moved off the surface, 4 journals, 3 sliding-wall levers
    and 2 ingot caches. Every one of the nine level maps has at least one record.
  - **Passages between dungeon levels** are the same idea one step further: a
    dungeon's levels are streaming packages of one world with no recorded link
    between them, so the offline pipeline derives all 14 from where two levels'
    geometry meets. Each passage is published as its own TWO `map_markers` rows —
    one per level map, `Passage Down` / `Passage Up` — joined by `meta.link`
    (`to`/`map`/`x`/`y`/`label` for the other end), never a separate manifest.
    The 12 surface doors the offline pipeline already seeded carry the same
    `meta.link` key, so a client reading `meta.link` handles a door and a
    passage identically.

## UI

- Left **Filters** panel: Show all / Hide all, Travel / Gathering / Finds presets, expandable category → subtype toggles, “show only”
- **Leaflet.markercluster** for dense pins; **only Towns** stay out of bubbles (priority layer). Keeps/temples cluster with the rest.
- Search, YOU blip: `window.setMo2World(worldX, worldY, follow)` (raw UE metres — called by whatever host page embeds this map), `window.setMo2You(lat, lng, follow)` (canvas pixels), `?you=world:X,Y` / `?you=lat,lng`
- Bottom-left readout: canvas `lat`/`lng` + world X/Y under the cursor; click copies `lat,lng` (this is how calibration anchors are taken)

## Editing

Map art source-of-truth is per continent — see that continent's own README
(e.g. [`../sarducaa/README.md`](../sarducaa/README.md)) for where to copy
from before deploy.

Community pins (`map_markers`) stay **read-only** on this page — this build has
no write path for them, or for anything else on the map. There is no
bookmarks layer, no presence layer and no login: everything the page shows
comes from committed JSON, so a reader is never asked to trust the page with
an account.

## Static build

This repo ships exactly one build: the public, API-less one
(`src/main-static.js`). There is no live-data variant here — `src/config.js`,
`src/bookmarks/`, `src/presence/` and the live `poi/api.js` /
`discoveries/api.js` do not exist in this tree, and nothing under `src/` is
allowed to carry network code to a live endpoint (see `main-static.js`'s own
header comment for the enforced boundary).

- `npm run build` (`bin/build.mjs`) bundles `src/main-static.js` with esbuild
  into `dist/app-static.js` / `dist/app-static.css`, then stamps
  `sarducaa/static.html` with the output's content hash so a stale cached
  bundle can never be served silently.
- `npm run serve` (`server/serve.mjs`) serves the built tree with the same
  caching headers production uses — no PHP, no database, no separate dev
  server to keep in sync with prod.
- Pins and discoveries read a committed snapshot at
  `<continent>/data/static/{pins,discoveries}.json`
  (`sources/static/{pins,discoveries,data}.js`) instead of a live API;
  the taxonomy pins need is derived from the rows themselves rather than
  shipped separately, since there is no server here to own it.
- `npm run validate` (`bin/validate-snapshot.mjs`) enforces the publish
  contract on those snapshot files: only the listed fields may appear (no
  `owner`, `seq`, `api_key`, `user`, `account`, `ip`, …), and every date is
  quantised to day granularity. The snapshot is what a public visitor is
  allowed to see, and this check is what keeps a private field from
  round-tripping into it by accident.
