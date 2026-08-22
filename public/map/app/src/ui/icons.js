/*
 * Category id -> icon name, for the snapshot v3 taxonomy (manifest.json's
 * 36 categories, sarducaa/data/static/manifest.json is the authoritative
 * list). Only used by sources/static/points.js — v2's pins.js (deleted by
 * this cutover) was the only other caller, and it built its own ad-hoc
 * per-row palette instead of resolving a closed taxonomy, which is the
 * problem this file solves for v3.
 *
 * The set is closed and small on purpose: 15 files under assets/tabler/ and
 * 9 under assets/gameicons/ (24 total, `game:<name>` selects the latter —
 * see poi/icons.js's resolveIconSrc), committed because they are actually
 * drawn somewhere on this map already. There is no anvil, coin, ledger,
 * lever, watchtower or quest-board icon in either set, so several of the 36
 * categories below deliberately SHARE a glyph rather than inventing a 25th
 * file for one concept — sharing an icon is a visual compromise; shipping an
 * SVG nothing asked for and nobody reviewed is not. A category id that is not
 * in ICONS (a manifest that grows a 37th) falls back to "map-pin" rather than
 * a broken image, same contract the old bookmark-category resolver here had.
 *
 * One choice per category, with the non-obvious ones spelled out:
 *   bank/refining/lever -> box        no currency or mechanism icon exists;
 *                                     a container is the closest available
 *                                     to "a place things are stored/pulled"
 *   guard   -> game:outpost           the game's own watch-post pennant,
 *                                     not "swords" (bandit/training/boss) —
 *                                     a guard is a post you find, not a
 *                                     fight you pick
 *   trinkets -> game:relic            the game's own found-curio icon
 *                                     (gem + socket + sparkle) beats a plain
 *                                     tabler diamond for "small valuable"
 *   elevator -> game:stairs-down,
 *   exit     -> game:stairs-up        the only pair in the whole set that
 *                                     encodes direction — down INTO a level
 *                                     from the surface, up OUT of one back
 *                                     to it — so they get the two stair
 *                                     glyphs deliberately, not by coincidence
 *   dungeon  -> game:dungeon          v3 merged the old "dungeon" and
 *                                     "entrance" pin roles into one category
 *                                     (see poi/markers.js's makePoiMarker);
 *                                     both read as the same triple-arch gate
 *
 * REMOVED: v2's 42 slugified pin categories (ashir-craft, north-exit, the
 * four spellings of trinkets, …) and their bespoke ALIAS table. That table
 * existed because v2's taxonomy was open (any row.category slug could show
 * up); v3's taxonomy is closed and declared by manifest.json, so every id
 * this file will ever see is already known here.
 */
const ICONS = {
  // gathering
  resource: "plant",
  // wildlife
  creature: "paw",
  bandit: "swords",
  camp: "game:camp",
  // settlement
  town: "game:town",
  bank: "box",
  vendors: "package",
  broker: "diamond",
  guard: "game:outpost",
  stable: "paw",
  postal: "flag",
  tasks: "book",
  library: "book",
  housing: "building-community",
  elevator: "game:stairs-down",
  guild: "building-community",
  training: "swords",
  // crafting
  crafting: "wood",
  refining: "box",
  cooking: "fish",
  butchery: "paw",
  alchemy: "sparkles",
  trinkets: "game:relic",
  // faith
  priest: "user",
  spiritism: "sparkles",
  wayshrine: "game:wayshrine",
  // world
  dungeon: "game:dungeon",
  ruins: "building-fortress",
  tower: "package",
  landmark: "flag",
  cave: "game:cave",
  // A way IN, drawn with the same stairs glyph as the way OUT it pairs with:
  // the two are the same door seen from either side, and `exit` only ever
  // renders inside a dungeon while `entrance` only ever renders on the
  // surface, so they are never on screen together to be confused.
  entrance: "game:stairs-down",
  // interior
  exit: "game:stairs-up",
  boss: "swords",
  journal: "book",
  lever: "box",
  loot: "package"
};

export function iconName(categoryId) {
  return ICONS[categoryId] || "map-pin";
}
