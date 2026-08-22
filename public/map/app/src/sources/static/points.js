/*
 * The one catalogue for the public, API-less build's sanitised map data — a
 * committed snapshot instead of a live endpoint, read-only everywhere.
 *
 * v3 replaces v2's two files, sources/static/pins.js (a curated pin
 * catalogue, "pins.json") and sources/static/discoveries.js (an
 * auto-collected catalogue, "discoveries.json"), with ONE file reading ONE
 * row shape from ONE snapshot ("points.json") plus its taxonomy
 * ("manifest.json"). There is no longer a second catalogue to register or
 * boot: main-static.js registers this module alone.
 *
 * Every bit of presentation and rendering this needs already exists —
 * poi/index.js's boot() for the category/marker state and cluster layers,
 * poi/view.js's adopt()/presentation for the store row shape the filter
 * panel and search box read — because a point (a place with a category, a
 * name and a position) is exactly what that stack was built for. What
 * differs from the deleted pins.js is entirely in this file: where the rows
 * and the taxonomy come from, that there is nothing to write, and the four
 * places below where a snapshot row needs a genuinely new seam rather than
 * an existing one.
 *
 * ---- taxonomy comes from the manifest, never from the rows ------------
 *
 * v2's pins.json carried no taxonomy at all — pins.js derived one synthetic
 * category per distinct `row.category` slug, humanized on the fly. That is
 * exactly how v2 ended up with 42 categories for 24 concepts (craft beside
 * crafting, extraction beside extractors, four spellings of trinkets, and a
 * one-town "north-exit" category because one town plan happened to have the
 * words on it — see the batch context, not repeated here). v3's
 * manifest.json DECLARES the 36-category, 7-group taxonomy up front
 * (`categories`, `groups`); reshape() below reads it, never slugifies a row.
 * A row naming a category the manifest never declared is a data bug the
 * exporter should not have shipped — view/filters.js's groupsOf() already
 * backfills and surfaces exactly that case, so nothing here duplicates it.
 *
 * ---- position is world metres, projected once here --------------------
 *
 * v2 published BOTH canvas pixels (map_x/map_y) and world metres on every
 * pin — 21 KB of a second position that could (and, measured over the 397
 * v2 pins, by up to 0.064 px, did) disagree with the first. v3 publishes
 * world metres only; map/projection.js's worldToMap() (the map's single,
 * already-fitted calibration — see public/map/registry.js) is the one place
 * that turns them into the canvas pixels poi/state.js's markers are drawn
 * in. Nothing here re-derives or copies that fit.
 *
 * ---- map gating: a row states which map it is on -----------------------
 *
 * v2's rows carried no `map` field, so map/active-map.js's mapOf() fell back
 * to the surface for every one of them and onActiveMap() could never gate a
 * pin out of the surface view: 25 dungeon-interior pins rendered on the
 * surface stacked on their own entrances. v3 states `map` on every point in
 * the `interior` group, and reshape() passes it straight through as `m.map`
 * — the exact field mapOf() and normalizePin() already read from a raw
 * marker/row, so no other file needed to change for the gate to start
 * firing.
 *
 * ---- dungeon linking: a row states which dungeon it belongs to ---------
 *
 * map/dungeonmode.js's setDungeonLink().resolve(poi) reads `poi.dungeon ||
 * dungeonKeyOf(poi.meta)` to decide whether a pin's popup offers "Open
 * dungeon map". The live catalogue derives that key from a meta.poi_id
 * convention (poi/markers.js's dungeonRole/dungeonKeyOf); v3 instead states
 * the key directly as `dungeon` on the row (present on the `dungeon`
 * category and every `interior`-group category), and reshape() passes it
 * through as `m.dungeon` — makePoiMarker() now reads that field first (see
 * its own doc), so a v3 "dungeon" pin still offers the door with zero
 * meta.poi_id invented for it.
 *
 * ---- flat filter list, groups from the manifest, not a second level ----
 *
 * v2 set every pin's `type` to humanize(category) — identical for every row
 * in a category — so the filter panel rendered 42 category rows each
 * expanding to exactly one identically-named type row ("Bank > Bank", "Camp
 * > Camp"): a dead second taxonomy level. v3 rows have no `type` at all
 * (reshape() always passes `type: null`), and the `types`/`subGroups` slot
 * poi/view.js's presentation exposes for a two-level taxonomy is turned off
 * below rather than fed an empty one, so view/filters.js renders the flat
 * list its own doc says an absent subGroups produces. In its place, the
 * `presets` slot (also documented there) exposes the manifest's 7 GROUPS —
 * poi/view.js's own generic presets() derives a preset per `category.
 * group_key` already, but titlecases the raw key, which does not reproduce
 * "Settlements" or "Dungeon interior" from "settlement"/"interior"; this
 * source overrides `presets` with the manifest's own group labels instead of
 * widening the shared generic to a naming rule it would need for no other
 * caller.
 *
 * ---- read-only ----------------------------------------------------------
 *
 * This descriptor declares no save/create/remove, `can.drag` is false (so
 * poi/markers.js never constructs a marker draggable in the first place —
 * see isDragCapable()'s own doc), and it never calls poi/markers.js's
 * setMarkerActions, so the popup built there renders no Edit / Drag / Delete
 * button. A published row's `n` (how many things a merged point represents)
 * is deliberately NOT surfaced: it is a publishing detail, not something a
 * reader of the map wants in a popup.
 */
import { boot } from "../../poi/index.js";
import { getCategories } from "../../poi/state.js";
import { presentCountFor } from "../../poi/markers.js";
import { iconName } from "../../ui/icons.js";
import { worldToMap } from "../../map/projection.js";
import { adopt, attachStore, presentation, wireNotifications } from "../../poi/view.js";
import { loadSnapshot } from "./data.js";

// Read-only end to end: no create/edit/remove/drag/bulk. Shared between
// `source.can` (what the registry and the rest of the app ask about this
// source) and the `can` handed into boot()'s data (poi/state.js's
// isDragCapable() reads data.can.drag) — one object, so the two can never
// disagree about whether this source may drag a marker.
const CAN = { create: false, edit: false, remove: false, drag: false, bulk: false };

// One colour per manifest GROUP, not per category: colouring each of the 36
// categories separately is exactly the per-row visual noise the taxonomy
// cleanup fixed for the filter panel (42 near-identical rows) — doing the
// same thing to colour would just move the noise onto the map. Grouping by
// colour instead means a reader can tell "this is a crafting pin" at a
// glance before ever reading its icon, the same way the filter panel groups
// them. Seven entries because the manifest currently declares seven groups;
// an eighth would fall back to DEFAULT_COLOR (the same muted bronze the
// rest of this map's chrome already uses) rather than throw.
const GROUP_COLOR = {
  gathering: "#5f8f6a",
  wildlife: "#a05a4a",
  settlement: "#6f8ba8",
  crafting: "#8a6a3d",
  faith: "#a8823f",
  world: "#7d7f9a",
  interior: "#5a8a9a"
};
const DEFAULT_COLOR = "#8a6a3d";

// Set by the last successful reshape(): the manifest's own groups, in the
// manifest's own order and with the manifest's own labels, for `presets`.
// Module-level rather than threaded through the descriptor's closures because
// `presets` is called by view/filters.js long after load() has returned, on
// every render.
let manifestGroups = [];

/**
 * Reshapes one manifest + one points.json snapshot into the canonical
 * `{categories, types, counts, type_counts, markers}` shape boot() and
 * poi/view.js's adopt() already take from a live /map-data payload — the
 * seam that lets this file be small and every other line of poi/ stay
 * untouched.
 */
function reshape(manifest, rows) {
  manifestGroups = manifest.groups || [];

  const categories = (manifest.categories || []).map(function (c, i) {
    return {
      id: c.id,
      label: c.label,
      color: GROUP_COLOR[c.group] || DEFAULT_COLOR,
      icon: iconName(c.id),
      // Place-name and doorway categories keep out of clusters. `town` and
      // `dungeon` get the labelled, never-clustered treatment anyway
      // (poi/state.js's isTownCategory() plus poi/markers.js's own "dungeon"
      // check) — set false here too so the two cannot disagree. `entrance` is
      // the third: it is deliberately UNLABELLED (three doors within ~500 m of
      // a labelled dungeon is a pile of text) but it must never be swallowed
      // into a numbered bubble either, because a way in is the one thing a
      // reader is looking for when they zoom to a dungeon.
      clusterable: c.id !== "town" && c.id !== "dungeon" && c.id !== "entrance",
      sort_order: i,
      group_key: c.group
    };
  });

  const markers = [];
  for (const row of rows || []) {
    if (!row || !row.id || !row.cat) { continue; }
    const projected = worldToMap(row.x, row.y);
    if (!projected) { continue; }
    markers.push({
      id: String(row.id),
      category: row.cat,
      name: row.name || null,
      type: null,
      x: projected.lng,
      y: projected.lat,
      // Absent on every category except `dungeon` and the `interior` group
      // (map/active-map.js's mapOf() already treats an absent map as the
      // surface, which is correct here: every other category IS on it).
      map: row.map || null,
      // Absent except on `dungeon` and `interior`-group rows; see
      // makePoiMarker's own doc for why `m.dungeon` wins there.
      dungeon: row.dungeon || null,
      note: null,
      disposition: null,
      meta: null
    });
  }

  return { categories: categories, types: {}, counts: {}, type_counts: {}, markers: markers, can: CAN };
}

const source = {
  id: "points",
  label: "Points",
  icon: "map-pin",
  can: CAN,

  attach: function (next) {
    attachStore(next);
    wireNotifications();
  },

  /** Loads the committed snapshot once. Refresh re-reads the same two files. */
  load: function () {
    return Promise.all([
      loadSnapshot("manifest.json"),
      loadSnapshot("points.json")
    ]).then(function (results) {
      const data = reshape(results[0], results[1]);
      boot(data);
      adopt(data);
    }).catch(function (err) {
      const empty = { categories: [], types: {}, counts: {}, type_counts: {}, markers: [], can: CAN };
      boot(empty);
      adopt(empty);
      throw err;
    });
  },

  ...presentation,

  /*
   * The declared taxonomy, minus any category with no point on the map the
   * reader is currently standing on. Two different cases, one rule:
   *
   *   - `boss` has no points anywhere. Its four rooms are withheld because
   *     the extraction knows which dungeon they are in but not which LEVEL,
   *     and an interior room drawn at its surface projection is a lie about
   *     where it is.
   *   - `exit`, `journal`, `lever` and `loot` have points, all of them
   *     inside a dungeon. On the surface they are not "filtered out", they
   *     are not there; in dungeon mode they appear.
   *
   * presentCountFor, NOT visibleCountFor: the latter applies the category
   * toggle and the global query, so filtering on it would delete a row the
   * instant the reader switched that category off. A category stays
   * registered either way (poi/state.js's getCategories() still returns it,
   * so dungeon linking and any future row filed under it resolve); this only
   * decides whether the filter panel draws a row for it, and an always-"0"
   * toggle is noise a reader cannot act on rather than a fact about their
   * query the way every other count is.
   */
  groups: function () {
    return presentation.groups().filter(function (g) { return presentCountFor(g.id) > 0; });
  },

  /*
   * The manifest's 7 groups, with the manifest's own labels ("Settlements",
   * "Dungeon interior", …) rather than a label title-cased from the raw group
   * key, which only coincidentally reads correctly for four of the seven.
   *
   * A GETTER, not a method: view/filters.js's presetsOf() tests
   * `Array.isArray(source.presets)` and silently renders no preset row for
   * anything else, so a `presets()` function is indistinguishable from having
   * none. A getter satisfies that test while still being recomputed per
   * render, which it must be — getCategories() is empty until load() has
   * booted, and a snapshot of it taken when this module was imported would be
   * permanently empty.
   */
  get presets() {
    const out = [];
    for (const group of manifestGroups) {
      // Only categories actually on this map, so a preset can never be a
      // button that selects nothing: inside a dungeon every group except
      // "Dungeon interior" is empty, and on the surface that group is.
      const groupIds = getCategories()
        .filter(function (c) { return c.group_key === group.id && presentCountFor(c.id) > 0; })
        .map(function (c) { return c.id; });
      if (groupIds.length) { out.push({ id: group.id, label: group.label, groupIds: groupIds }); }
    }
    return out;
  },

  // No second taxonomy level: every v3 row's `type` is null (see reshape()'s
  // own doc for why that is deliberate, not an omission), so there is
  // nothing to expand a category into. Explicitly undefined rather than a
  // function returning `[]`, so view/filters.js's own `typeof source.
  // subGroups !== "function"` check treats this exactly like a source that
  // never had a second level, per that module's own contract doc.
  subGroups: undefined,
  isSubGroupEnabled: undefined,
  setSubGroupEnabled: undefined
};

export default source;
