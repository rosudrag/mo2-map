/*
 * The list of manageable marker sources, the active tab, and the per-source view
 * preferences that survive a reload.
 *
 * Every source describes itself (see the typedef below) and this module is the
 * only thing that knows there is more than one of them. manage/panel.js,
 * list.js, editor.js and filters.js all reach their data through here, which is
 * why none of them contains a branch on which source it is drawing: adding a
 * fourth marker system is a descriptor and one `register()` call in main.js.
 *
 * The registry also owns the two things that are per-manager rather than
 * per-source: which tab is active, and the map gestures that follow it.
 */
import { createStore, GROUPS, VIEW } from "./store.js";
import { map } from "../map/instance.js";
import { setMapClickClaim } from "../map/click-claim.js";
import { currentMapId } from "../map/current.js";

/**
 * @typedef {Object} ManageSource
 * @property {string}  id            "pins" | "bookmarks" | "discoveries"
 * @property {string}  label         tab label
 * @property {string}  icon          tabler icon name for the tab chip
 * @property {Caps}    can
 *
 * -- data ---------------------------------------------------------------
 * @property {() => Promise<void>} load       resolves once first data is in; a
 *                                            second call is a full re-read
 * @property {(fn: () => void) => void} onChange fires whenever rows/groups change
 * @property {() => Object[]} rows            ACTIVE rows only, never tombstones
 * @property {(row) => string} rowId
 *
 * -- presentation -------------------------------------------------------
 * @property {(row) => string} title
 * @property {(row) => string} subtitle       already plain text
 * @property {(row) => string} iconName
 * @property {(row) => string} accent         "#rrggbb"
 * @property {(row) => {lat:number,lng:number}|null} latLng
 * @property {(row) => string} searchText     lower-cased haystack
 *
 * -- grouping -----------------------------------------------------------
 * @property {() => Group[]} groups           [{ id, label, color, icon, count }]
 * @property {(row) => string} groupOf
 * @property {(groupId) => boolean} isGroupEnabled
 * @property {(groupId, on: boolean) => void} setGroupEnabled
 * @property {() => boolean} layerOn
 * @property {(on: boolean) => void} setLayerOn
 *
 * -- sorting ------------------------------------------------------------
 * @property {Sort[]} sorts   [{ value, label, compare(a, b, ctx) }]
 *                            ctx = { youWorld: {x,y}|null }
 *
 * -- editing (only what `can` allows is ever called) --------------------
 * @property {Field[]} fields
 * @property {(row) => Object} toForm
 * @property {(id, values) => Promise<void>} save
 * @property {(ids) => Promise<void>} remove
 * @property {(latlng) => Promise<string>} create   -> new row id
 * @property {(id) => void} reveal                  fly to + open popup
 *
 * -- OPTIONAL. A source that omits these renders correctly without them, and
 *    no caller may assume they exist. They are part of the contract, not
 *    accidents: each one exists because a working feature would otherwise have
 *    been flattened away.
 * @property {(store) => void} [attach]        the registry hands the source its
 *                                             store the moment it is created
 * @property {string} [createLabel]           "a bookmark" — names the target in
 *                                            #add-hint. Required in practice by
 *                                            any source with can.create.
 * @property {(groupId) => Group[]} [subGroups]           second taxonomy level
 * @property {(groupId, subId) => boolean} [isSubGroupEnabled]
 * @property {(groupId, subId, on) => void} [setSubGroupEnabled]
 * @property {{id, label, groupIds: string[]}[]} [presets] one-click group sets
 * @property {() => {ok: boolean, hint?: string}} [health] poll staleness tell
 * @property {{id, label, run(ids, anchorEl)}[]} [bulkActions]
 * @property {{id, label, title, danger?, on?(row), run(id, anchorEl)}[]} [rowActions]
 * @property {(ids) => string|null} [removeWarning] non-null text => confirm first
 * @property {(id|null) => void} [setHot]      emphasise one marker
 * @property {(fn) => void} [onHot]            marker hover -> echo in the list
 * @property {(handlers) => void} [setPopupActions] {edit, rename, remove} from a
 *                                             marker popup back into the manager
 * @property {() => void} [forgetKey]          drop this source's stored API key
 * @property {boolean} [aggregate]             true when this source's rows are a
 *                                             JOIN over the other registered
 *                                             sources' rows rather than a
 *                                             catalogue of its own — see
 *                                             manage/sources/all.js. Two readers,
 *                                             one meaning: manage/filters.js
 *                                             renders no section for it (the
 *                                             owners already render the same
 *                                             layer toggles) and
 *                                             manage/querybox.js leaves it out of
 *                                             the per-source match counts (it
 *                                             would report every match twice).
 */

/** @typedef {Object} Caps
 *  @property {boolean} create
 *  @property {boolean} edit
 *  @property {boolean} remove
 *  @property {boolean} drag
 *  @property {boolean} bulk
 */

// The active tab, and one blob of view state per source. Separate items on
// purpose: a corrupt blob in one source's prefs must not take the others down
// with it, which is the same reason discoveries/state.js keeps its own key.
// Per-map: computed once at import time, same as active-map.js's SURFACE_MAP.
const TAB_ITEM = "mo2map." + currentMapId() + ".manage-tab";
const PREFS_PREFIX = "mo2map." + currentMapId() + ".manage.";

/*
 * editMode is deliberately NOT persisted: coming back to a page that silently
 * rewrites a pin on the next map click is a nasty surprise. panelOpen is not
 * here either — the panel is one aside shared by every tab, so it is the
 * panel's state, not a source's.
 */
const VIEW_KEYS = ["groupFilter", "sortKey", "sortDesc", "group"];

const entries = [];
const byId = Object.create(null);
const activeListeners = [];
let currentId = "";

function readJson(item) {
  try {
    const raw = window.localStorage.getItem(item);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeItem(item, value) {
  try { window.localStorage.setItem(item, value); } catch { /* private mode */ }
}

function loadPrefs(entry) {
  const saved = readJson(PREFS_PREFIX + entry.id);
  if (!saved) { return; }
  const patch = {};
  for (const k of VIEW_KEYS) {
    if (saved[k] !== undefined) { patch[k] = saved[k]; }
  }
  entry.store.setView(patch);
  if (saved.groupEnabled && typeof saved.groupEnabled === "object") {
    entry.store.setGroupsEnabled(saved.groupEnabled);
  }
  // Through the SOURCE, not the store: switching a layer off is also a Leaflet
  // operation for two of the three sources, and only the source knows which.
  if (saved.layerOn === false) { entry.source.setLayerOn(false); }
}

function savePrefs(entry) {
  const view = entry.store.getView();
  const out = { groupEnabled: entry.store.groupEnabledMap(), layerOn: entry.source.layerOn() };
  for (const k of VIEW_KEYS) { out[k] = view[k]; }
  writeItem(PREFS_PREFIX + entry.id, JSON.stringify(out));
}

function announceActive() {
  for (const fn of activeListeners) { fn(currentId); }
}

/**
 * Adds a source. Registration order is tab order, and this is pure bookkeeping:
 * no fetch, no DOM, so the registry is complete before anything mounts.
 */
export function register(source) {
  if (byId[source.id]) { return byId[source.id].store; }

  const store = createStore({
    rowId: source.rowId,
    groupOf: source.groupOf,
    searchText: source.searchText
  });
  const entry = { id: source.id, source: source, store: store };
  entries.push(entry);
  byId[source.id] = entry;

  // Before prefs: the source has to be holding its store before anything can
  // set view state on it.
  if (source.attach) { source.attach(store); }
  loadPrefs(entry);
  store.subscribe([VIEW, GROUPS], function () { savePrefs(entry); });

  // The stored tab wins over registration order, but only once it actually
  // exists — a pref naming a retired source must not leave the manager pointing
  // at nothing.
  let wanted = "";
  try { wanted = window.localStorage.getItem(TAB_ITEM) || ""; } catch { wanted = ""; }
  if (!currentId || wanted === source.id) {
    currentId = source.id;
    announceActive();
  }
  return store;
}

/** Every registered source, in registration (tab) order. */
export function sources() {
  return entries.map(function (e) { return e.source; });
}

export function get(id) {
  return byId[id] ? byId[id].source : null;
}

export function storeFor(id) {
  return byId[id] ? byId[id].store : null;
}

export function activeId() {
  return currentId;
}

export function activeSource() {
  return byId[currentId] ? byId[currentId].source : null;
}

export function activeStore() {
  return byId[currentId] ? byId[currentId].store : null;
}

export function setActive(id) {
  if (!byId[id] || id === currentId) { return; }
  currentId = id;
  writeItem(TAB_ITEM, id);
  announceActive();
}

/**
 * Subscribes to tab changes. Fires immediately with the current tab if there is
 * one, so a caller that mounts after the sources were registered still gets the
 * restored tab without having to ask for it separately.
 */
export function onActiveChange(fn) {
  activeListeners.push(fn);
  if (currentId) { fn(currentId); }
}

// ---- map gestures follow the active tab --------------------------------------
/*
 * Creating a marker by pointing at the map used to be wired twice, once per
 * source, with two different gestures: bookmarks claimed the empty-map LEFT
 * click while in edit mode (map/click-claim.js), and the pin catalogue took
 * every RIGHT click unconditionally. Two systems, one map, and no way to tell
 * which one a click was about to touch.
 *
 * Both gestures now target the ACTIVE tab, and each keeps the gate it had:
 *
 *   right-click — no mode needed. It is already an unambiguous, deliberate
 *     gesture, and it is the most common authoring action on this map; putting
 *     it behind Edit would turn one action into three (open panel, pick tab,
 *     arm Edit). #add-hint has advertised the one-gesture version all along.
 *   left-click on empty map — still requires edit mode, because left-click IS
 *     ambiguous: it also pans, deselects and copies the world coordinate (that
 *     is how calibration anchors are taken, docs/map-coordinates.md).
 *
 * Because the target now depends on a tab, the hint has to name the tab — a
 * gesture whose destination is implicit produces a first surprise write the
 * user cannot explain.
 */
function createHere(latlng) {
  const source = activeSource();
  if (!source || !source.can.create) { return false; }
  Promise.resolve(source.create(latlng)).catch(function () {
    // The source reports its own failure (toast + rollback); a rejection here
    // only means "no marker was made", which the map already shows.
  });
  return true;
}

setMapClickClaim(function (latlng) {
  const store = activeStore();
  if (!store || !store.getView().editMode) { return false; }
  return createHere(latlng);
});

map.on("contextmenu", function (e) {
  // preventDefault only when the gesture is actually ours: with a source that
  // cannot create, the browser context menu is the correct behaviour rather than
  // a swallowed click.
  if (!createHere(e.latlng)) { return; }
  if (e.originalEvent) { e.originalEvent.preventDefault(); }
});

function syncAddHint() {
  const hint = document.getElementById("add-hint");
  if (!hint) { return; }
  const source = activeSource();
  const can = !!(source && source.can.create);
  hint.classList.toggle("hidden", !can);
  if (!can) { return; }
  hint.innerHTML = "Right-click map to <strong>add " +
    (source.createLabel || source.label.toLowerCase()) + "</strong>";
}

onActiveChange(syncAddHint);
