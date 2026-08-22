// Committed Tabler SVGs live in the shared app assets, not the per-continent
// assets/ - this icon set is UI chrome, not map art, so it does not belong to
// any one continent. Page-relative from a continent's index.html
// (public/map/<mapId>/), one level up into app/. See styles/ and FILES in
// ui/icons.js for why the set is closed.
export const TABLER = "../app/assets/tabler/";

// The game's own 20x20 PNG icon set (Dungeon, Cave, Town, Wayshrine, Outpost,
// Relic, Camp), redrawn as SVG so they read crisp at marker size instead of
// upscaling. A `map_types.icon` value of
// `game:<name>` resolves here instead of TABLER; see poi/icons.js. Shared app
// assets for the same reason as TABLER above.
export const GAMEICONS = "../app/assets/gameicons/";

/*
 * The one place a `game:<name>` icon name becomes a URL.
 *
 * It used to live only in poi/icons.js's resolveIconSrc, which was fine while
 * `game:` names were reachable only from a map marker. Snapshot v3 puts them on
 * CATEGORIES (`game:town`, `game:camp`, `game:dungeon`, …), and a category's
 * icon is drawn by the filter panel too - which had its own bare
 * `TABLER + name + ".svg"` concat and requested `tabler/game:town.svg`, a 404
 * and a blank square in the panel while the same category's marker rendered
 * correctly. Two concatenations of the same thing, one of which knew about the
 * prefix.
 */
export function iconSrc(name) {
  const icon = name || "map-pin";
  return icon.startsWith("game:")
    ? GAMEICONS + icon.slice("game:".length) + ".svg"
    : TABLER + icon + ".svg";
}
