// Committed Tabler SVGs live in the shared app assets, not the per-continent
// assets/ - this icon set is UI chrome, not map art, so it does not belong to
// any one continent. Page-relative from a continent's index.html
// (public/map/<mapId>/), one level up into app/. See styles/, FILES in
// ui/icons.js, and docs/bookmarks.md on why the set is closed.
export const TABLER = "../app/assets/tabler/";

// The game's own 20x20 PNG icon set (Dungeon, Cave, Town, Wayshrine, Outpost,
// Relic, Camp), redrawn as SVG so they read crisp at marker size instead of
// upscaling — see docs/improve-map-pois.md §3. A `map_types.icon` value of
// `game:<name>` resolves here instead of TABLER; see poi/icons.js. Shared app
// assets for the same reason as TABLER above.
export const GAMEICONS = "../app/assets/gameicons/";
