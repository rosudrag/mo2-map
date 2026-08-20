/*
 * Icon-name resolution for bookmark categories.
 *
 * Only the SVGs listed here are committed under assets/tabler/. A taxonomy may
 * name an icon that was never vendored — the contract's ideal set asks for
 * home / pick / businessplan / alert-triangle / skull / route, none of which
 * exist on disk — so every name is resolved through the alias table and falls
 * back to map-pin rather than rendering a broken image.
 *
 * Do not "fix" the seed to the obvious names without committing the SVGs first:
 * a missing file 404s silently and only a human looking at the map notices.
 * See docs/bookmarks.md "Category icons — why they are not the obvious names".
 */
const FILES = {
  "book": true, "box": true, "building-community": true, "building-fortress": true,
  "diamond": true, "fish": true, "flag": true, "map-pin": true, "package": true,
  "paw": true, "plant": true, "sparkles": true, "swords": true, "user": true, "wood": true
};

const ALIAS = {
  "home": "building-community",
  "pick": "diamond",
  "businessplan": "package",
  "alert-triangle": "swords",
  "skull": "building-fortress",
  "route": "flag"
};

export function iconName(name) {
  const raw = name ? String(name) : "map-pin";
  if (FILES[raw]) { return raw; }
  const alias = ALIAS[raw];
  if (alias && FILES[alias]) { return alias; }
  return "map-pin";
}
