/*
 * The join tab: every owner source's rows in one list, wearing the owner's
 * label so it always says where it came from.
 *
 * This is NOT a fourth catalogue. It holds no rows of its own — a wrapper
 * row is `{ id, owner, row }`, `row` being the exact object the owner's store
 * is holding, so a write anywhere shows up here for free. It exists because
 * the old #search box could only isolate ONE group at a time (hiding the
 * other two catalogues behind an empty Set, see docs/marker-management.md §9)
 * and the manager's own tabs never let you see two sources side by side.
 *
 * Registered FIRST in main.js, so it is tab one and the default landing tab —
 * "everything" is the more useful first view than any one catalogue.
 *
 * THE DESCRIPTOR CONTRACT, not a special case: this file enumerates
 * registry.sources() (it has to, to be a join), but it never names a source —
 * every owner-specific choice below reads from the owner's own descriptor.
 * `aggregate: true` is the one thing core code had to be told about it, and
 * that is a capability flag, not an id branch.
 */
import { get as getSource, setActive, sources as registrySources } from "../sources-registry.js";
import { openEditor } from "../editor.js";
import { mapToWorld } from "../../map/projection.js";
import { getYouWorld } from "../../you/blip.js";
import { GROUPS, ROWS } from "../store.js";

let store = null;

// Wrapper rows, rebuilt from every OTHER registered source and memoised: a
// sort over 2,000+ rows must not re-walk three catalogues on every render
// call, and a render call happens on every scroll tick.
let cachedRows = null;
let cachedById = null;
let invalidationBound = false;

/** Every other registered source — self-excluded by reference, not by id. */
function owners() {
  return registrySources().filter(function (s) { return s !== source; });
}

function rebuildRows() {
  cachedRows = [];
  cachedById = Object.create(null);
  for (const owner of owners()) {
    for (const row of owner.rows()) {
      const wrapper = { id: owner.id + ":" + owner.rowId(row), owner: owner.id, row: row };
      cachedRows.push(wrapper);
      cachedById[wrapper.id] = wrapper;
    }
  }
}

/*
 * Binds the cache invalidation exactly once, lazily — NOT from attach(),
 * because this source is registered FIRST (main.js), so at attach() time
 * registry.sources() holds only itself and owners() would be empty. By the
 * time anything actually asks for a row (after every register() call in
 * main.js has run), the other three exist and this binds correctly.
 */
function ensureRows() {
  if (!invalidationBound) {
    invalidationBound = true;
    for (const owner of owners()) {
      owner.onChange(function () {
        cachedRows = null;
        cachedById = null;
        store.notify(ROWS, GROUPS);
      });
    }
  }
  if (!cachedRows) { rebuildRows(); }
  return cachedRows;
}

function wrapperById(id) {
  ensureRows();
  return cachedById[id] || null;
}

/** Splits wrapper ids by owner, translating each back to the owner's OWN row id. */
function groupIdsByOwner(ids) {
  const byOwner = Object.create(null);
  for (const id of ids) {
    const w = wrapperById(id);
    if (!w) { continue; }
    const owner = getSource(w.owner);
    if (!owner) { continue; }
    if (!byOwner[w.owner]) { byOwner[w.owner] = []; }
    byOwner[w.owner].push(owner.rowId(w.row));
  }
  return byOwner;
}

/*
 * Every row's world position, through the SAME path list.js's own distance
 * column uses (mapToWorld . latLng): pins are canvas pixels, bookmarks and
 * discoveries are world metres already, and this is what makes "nearest to
 * you" comparable across all three without this file knowing which is which.
 */
function worldOf(row) {
  const owner = getSource(row.owner);
  const ll = owner ? owner.latLng(row.row) : null;
  return ll ? mapToWorld(ll.lat, ll.lng) : null;
}

/* With no origin every row is equally far away — 0, not Infinity, so the sort
 * stays a total order (Infinity - Infinity is NaN, which is not). */
function sqDistance(origin, world) {
  if (!origin || !world) { return 0; }
  const dx = world.x - origin.x;
  const dy = world.y - origin.y;
  return dx * dx + dy * dy;
}

function byTitle(a, b) {
  const owner = getSource(a.owner);
  const at = (owner ? owner.title(a.row) : "").toLowerCase();
  const bo = getSource(b.owner);
  const bt = (bo ? bo.title(b.row) : "").toLowerCase();
  if (at === bt) { return 0; }
  return at < bt ? -1 : 1;
}

function bySource(a, b) {
  if (a.owner !== b.owner) { return a.owner < b.owner ? -1 : 1; }
  return byTitle(a, b);
}

const source = {
  id: "all",
  label: "All",
  icon: "flag",
  // Delete only: an aggregate view has nothing to author (create/edit would
  // mean picking an owner on its behalf) and no drag of its own to offer —
  // and no bulk bar, because a bulk action here would have to fan out across
  // three different write paths pretending to be one.
  can: { create: false, edit: false, remove: true, drag: false, bulk: false },

  /*
   * "My rows belong to somebody else." Two readers, one meaning:
   * manage/filters.js renders no section (the three layer toggles already
   * live in the owners' own sections) and manage/querybox.js leaves this
   * source out of the per-source match counts (counting it would report
   * every match twice and double the total).
   */
  aggregate: true,

  attach: function (next) {
    store = next;
  },

  // Owners boot themselves (main.js bootSource is not called for this one);
  // there is nothing here to load.
  load: function () {
    return Promise.resolve();
  },

  onChange: function (fn) {
    for (const owner of owners()) { owner.onChange(fn); }
  },

  rows: function () {
    return ensureRows();
  },

  rowId: function (row) {
    return row.id;
  },

  title: function (row) {
    const owner = getSource(row.owner);
    return owner ? owner.title(row.row) : "";
  },

  /*
   * NOT prefixed with the owner's label: list.js already draws the row's
   * GROUP as a chip, and on this tab the group IS the owner — a prefix here
   * rendered "Bookmarks Bookmarks · Waypoint" on every row.
   */
  subtitle: function (row) {
    const owner = getSource(row.owner);
    return owner ? owner.subtitle(row.row) : "";
  },

  iconName: function (row) {
    const owner = getSource(row.owner);
    return owner ? owner.iconName(row.row) : "map-pin";
  },

  accent: function (row) {
    const owner = getSource(row.owner);
    return owner ? owner.accent(row.row) : "#8a6a3d";
  },

  latLng: function (row) {
    const owner = getSource(row.owner);
    return owner ? owner.latLng(row.row) : null;
  },

  // The owner's id folded in ahead of its own haystack, so a query anchored
  // with `^pins` narrows to one owner without a group-filter click.
  searchText: function (row) {
    const owner = getSource(row.owner);
    if (!owner) { return ""; }
    return (owner.id + " " + owner.searchText(row.row)).toLowerCase();
  },

  // One group per owner, standing in for the three layer toggles a filter
  // section would otherwise show — this is how "Show only Bookmarks" works
  // from the toolbar's group-filter picker even though there is no section.
  groups: function () {
    return owners().map(function (owner) {
      return {
        id: owner.id,
        label: owner.label,
        color: "",
        icon: owner.icon,
        count: owner.rows().length
      };
    });
  },

  groupOf: function (row) {
    return row.owner;
  },

  isGroupEnabled: function (groupId) {
    const owner = getSource(groupId);
    return owner ? owner.layerOn() : true;
  },

  setGroupEnabled: function (groupId, on) {
    const owner = getSource(groupId);
    if (owner) { owner.setLayerOn(on); }
  },

  layerOn: function () {
    return owners().some(function (owner) { return owner.layerOn(); });
  },

  setLayerOn: function (on) {
    for (const owner of owners()) { owner.setLayerOn(on); }
  },

  sorts: [
    { value: "name", label: "Name", compare: byTitle },
    { value: "source", label: "Source", compare: bySource },
    {
      value: "distance",
      label: "Nearest to you",
      compare: function (a, b, ctx) {
        const origin = ctx && ctx.youWorld;
        return sqDistance(origin, worldOf(a)) - sqDistance(origin, worldOf(b));
      }
    }
  ],

  // No generic editor: three sources have three field schemas, and a merged
  // one would be a lie about what any single row actually is. Open (below)
  // is how you get to the real editor.
  fields: [],

  toForm: function () {
    return {};
  },

  save: function () {
    return Promise.reject(new Error(
      "The All tab has no editor of its own — use Open to edit a row on its " +
      "owner's tab (can.edit is false)."
    ));
  },

  create: function () {
    return Promise.reject(new Error(
      "The All tab cannot create rows — switch to the tab you want to add to " +
      "(can.create is false)."
    ));
  },

  remove: function (ids) {
    const byOwner = groupIdsByOwner(ids);
    const jobs = [];
    for (const ownerId of Object.keys(byOwner)) {
      const owner = getSource(ownerId);
      if (owner) { jobs.push(owner.remove(byOwner[ownerId])); }
    }
    return Promise.all(jobs).then(function () {});
  },

  removeWarning: function (ids) {
    const byOwner = groupIdsByOwner(ids);
    const texts = [];
    for (const ownerId of Object.keys(byOwner)) {
      const owner = getSource(ownerId);
      const text = owner && owner.removeWarning ? owner.removeWarning(byOwner[ownerId]) : null;
      if (text) { texts.push(text); }
    }
    return texts.length ? texts.join(" ") : null;
  },

  reveal: function (id) {
    const w = wrapperById(id);
    if (!w) { return; }
    const owner = getSource(w.owner);
    if (owner) { owner.reveal(owner.rowId(w.row)); }
  },

  // The only row action this tab needs: everything else (rename, drag, bulk
  // edits) is the owner's business, reached by switching to its tab.
  rowActions: [
    {
      id: "open",
      label: "\u2197",
      title: "Open on its own tab",
      run: function (id) {
        const w = wrapperById(id);
        if (!w) { return; }
        const owner = getSource(w.owner);
        if (!owner) { return; }
        setActive(w.owner);
        openEditor(owner, owner.rowId(w.row));
      }
    }
  ]
};

export default source;
