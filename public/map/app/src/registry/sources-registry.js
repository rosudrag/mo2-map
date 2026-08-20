/*
 * The list of registered marker sources, the active tab, and the per-source
 * view preferences that survive a reload.
 *
 * Every source describes itself (see the typedef below) and this module is the
 * only thing that knows there is more than one of them. view/filters.js and
 * view/search.js reach their data through here on every build; the private
 * repo's own panel, list and editor modules do too, for the build that has
 * them — none of them contains a branch on which source it is drawing, which
 * is why adding a fourth marker system is a descriptor and one `register()`
 * call in main.js.
 *
 * The registry also owns which tab is active and the per-source view prefs
 * that follow it. It does NOT own any map gesture: a click that creates a row
 * is an authoring feature with nowhere to write to on this, the public build,
 * so that lives in the private repo's own create-gesture module, wired
 * onto activeSource()/activeStore() exported below exactly the way a private
 * row list or field editor module would be.
 */
import { createStore, GROUPS, VIEW } from "./store.js";
import { currentMapId } from "../map/current.js";

/**
 * @typedef {Object} MarkerSource
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
 * -- editing (only what `can` allows is ever called; the public build calls
 *    none of these — it has no editor to call them from) --------------------
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
 *                                            the private build's #add-hint.
 *                                            Required in practice by any
 *                                            source with can.create.
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
 *                                             marker popup back into the private
 *                                             build's panel
 * @property {() => void} [forgetKey]          drop this source's stored API key
 * @property {boolean} [aggregate]             true when this source's rows are a
 *                                             JOIN over the other registered
 *                                             sources' rows rather than a
 *                                             catalogue of its own — see the
 *                                             private repo's own join-tab
 *                                             source (the public build never
 *                                             registers one). Two readers, one
 *                                             meaning: view/filters.js renders
 *                                             no section for it (the owners
 *                                             already render the same layer
 *                                             toggles) and view/search.js
 *                                             leaves it out of the per-source
 *                                             match counts (it would report
 *                                             every match twice).
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
const TAB_ITEM = "mo2map." + currentMapId() + ".active-tab";
const PREFS_PREFIX = "mo2map." + currentMapId() + ".source.";

/*
 * editMode is deliberately NOT persisted: coming back to a page that silently
 * rewrites a pin on the next map click is a nasty surprise. panelOpen is not
 * here either — the private build's panel is one aside shared by every tab,
 * so it is the panel's state, not a source's.
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
  // exists — a pref naming a retired source must not leave the registry
  // pointing at nothing.
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
