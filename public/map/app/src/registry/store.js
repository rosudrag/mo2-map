/*
 * One registered source's own state: rows, selection, view, groups and the
 * inline-rename draft — plus the change channels its renderers subscribe to.
 *
 * WHY THIS EXISTS. Before the bookmark split every mutator hand-called the
 * renderers it thought it had invalidated — `renderMarker` + `renderList` +
 * `renderFilterSection` + `syncCounts`, in that order, at ~15 call sites.
 * Forgetting one produced a UI that disagreed with itself, and forgetting none
 * produced a full list rebuild per mutation: a bulk tag over 40 rows rebuilt the
 * list 40 times, and any rebuild detaches the row the user is interacting with
 * (killing focus, selection and mid-click state). Both failures are recorded in
 * the project notes.
 *
 * So: mutate here, declare WHAT changed, and subscribers decide whether they
 * care. Notifications coalesce into one microtask, so a 40-row bulk edit renders
 * once.
 *
 * View state (filter, sort) lives here rather than being read back out of the
 * DOM inputs, which is what lets it be persisted and what lets the keyboard
 * layer change it without faking input events. The search TEXT itself moved
 * out — map/query.js owns one query for every source at once, see docs
 * §9 — so what is left here is what stays per-tab: the group filter and sort.
 *
 * ONE INSTANCE PER SOURCE, created by registry/sources-registry.js. The
 * channels coalescing are per instance too: a bookmark poll landing must not
 * make the pin catalogue re-render, and the pin catalogue is large enough for
 * that to show. Nothing in here knows what kind of row it is holding — the
 * three questions it has to ask a row (its id, its group and its search
 * haystack) arrive as config, so this file has no per-source branch and never
 * grows one.
 *
 * THE ONE INVARIANT AN ADAPTER MUST HONOUR: a row that can be edited, renamed or
 * removed has to be IN this store, adopted by id. The whole write path is built
 * on the row cache below — snapshot/mutateRows/restore is what makes an
 * optimistic write reversible — so a source that keeps its rows anywhere else
 * gets writes that silently do nothing. The list deliberately reads row DATA from
 * `source.rows()` instead (only the source knows what a tombstone is for its
 * system), which means it cannot see this requirement; that is why beginRename
 * reports whether it started rather than just declining.
 */
import { matches } from "../map/query.js";

// ---- change channels ---------------------------------------------------------
// Coarse on purpose. Finer channels would mean every mutator has to know the
// renderer topology again, which is the coupling this module removes.
export const ROWS = "rows";           // a row's data changed, or rows appeared/left
export const SELECTION = "selection"; // which rows are ticked
export const VIEW = "view";           // filter, sort, active row, rename draft
export const GROUPS = "groups";       // the group catalogue or its enabled flags

// A group slug the catalogue does not know still has to render, so it renders
// grey rather than throwing or drawing nothing.
const UNKNOWN_GROUP = { label: "", icon: "map-pin", color: "#c4a574", sort_order: 999 };

function defaultGroupOf() {
  return "";
}

function defaultSearchText() {
  return "";
}

/*
 * `status: "deleted"` is the tombstone convention of every cursored source on
 * this API (see docs/api.md): a delta reader is told about a removal by getting
 * the row back with that status, so the row must stay in the store — it is what
 * makes an Undo a correct write rather than a guess — while never appearing in a
 * list. A source with no tombstones simply has no `status` and is always active.
 */
function defaultIsActive(row) {
  return row.status !== "deleted";
}

function cloneRow(row) {
  return JSON.parse(JSON.stringify(row));
}

/**
 * @param {{rowId?: (row) => string, groupOf?: (row) => string,
 *          isActive?: (row) => boolean, searchText?: (row) => string}} [config]
 */
export function createStore(config) {
  const cfg = config || {};
  const rowIdOf = cfg.rowId || defaultRowId;
  const groupOfRow = cfg.groupOf || defaultGroupOf;
  const isActiveRow = cfg.isActive || defaultIsActive;
  const searchTextOf = cfg.searchText || defaultSearchText;

  const subscribers = [];
  let pendingTags = null;

  const rows = Object.create(null);
  const selected = Object.create(null);

  let groupList = [];
  const groupEnabled = Object.create(null);

  const view = {
    groupFilter: "",
    sortKey: "name",
    sortDesc: false,
    group: false,        // group the list under group headings
    panelOpen: false,
    layerOn: true,
    editMode: false,
    activeId: null,      // the "cursor" row: what the keyboard layer acts on
    anchorId: null       // shift-click range anchor
  };

  /*
   * The rename draft lives in the STORE, not in the <input>.
   *
   * The list rebuilds on any adopt — including a 5 s poll that picked up another
   * client's edit — and a rebuild destroys the input mid-keystroke. Keeping the
   * typed text, the caret and the target id here means a rebuild can reconstruct
   * the editor exactly where the user left it, so a background poll can no
   * longer eat a rename in progress.
   */
  const rename = { id: null, draft: "", caret: null };

  // ---- notification ----------------------------------------------------------
  function flush() {
    const tags = pendingTags;
    pendingTags = null;
    if (!tags) { return; }
    for (const s of subscribers) {
      for (const t of s.tags) {
        if (tags.has(t)) { s.fn(tags); break; }
      }
    }
  }

  /**
   * @param {string[]} tags channels this subscriber reacts to
   * @param {(tags: Set<string>) => void} fn
   */
  function subscribe(tags, fn) {
    subscribers.push({ tags: tags, fn: fn });
  }

  function notify(...tags) {
    if (!pendingTags) {
      pendingTags = new Set();
      // Microtask, not a timer: the DOM must be consistent before the browser
      // paints or hands control back to the user, but a burst of mutations in
      // one turn must still collapse into a single render.
      Promise.resolve().then(flush);
    }
    for (const t of tags) { pendingTags.add(t); }
  }

  /** Forces any queued notification to run now. Used before reading the DOM. */
  function flushNow() {
    if (pendingTags) { flush(); }
  }

  // ---- rows ------------------------------------------------------------------
  function getRow(id) {
    return rows[id] || null;
  }

  function allRows() {
    return Object.keys(rows).map(function (id) { return rows[id]; });
  }

  function activeRows() {
    return allRows().filter(isActiveRow);
  }

  function rowIds() {
    return Object.keys(rows);
  }

  /**
   * Adopts rows verbatim — already normalized by the source, because only the
   * source knows its wire shape. Returns the number adopted so callers can tell
   * an empty delta — the steady state of polling — from real news.
   */
  function adoptRows(list) {
    let adopted = 0;
    for (const row of list || []) {
      const id = rowIdOf(row);
      if (!id) { continue; }
      rows[id] = row;
      // A tombstoned row must not stay ticked: the bulk bar would then act on a
      // row that is no longer in any list.
      if (!isActiveRow(row)) { delete selected[id]; }
      adopted++;
    }
    if (adopted) { notify(ROWS, GROUPS); }
    return adopted;
  }

  /** Applies `mutate` to each id and notifies once. */
  function mutateRows(ids, mutate) {
    const touched = [];
    for (const id of ids) {
      const row = rows[id];
      if (!row) { continue; }
      mutate(row);
      touched.push(row);
    }
    if (touched.length) { notify(ROWS, GROUPS); }
    return touched;
  }

  function putRow(row) {
    rows[rowIdOf(row)] = row;
    notify(ROWS, GROUPS);
    return row;
  }

  function dropRow(id) {
    delete rows[id];
    delete selected[id];
    notify(ROWS, SELECTION, GROUPS);
  }

  /** Deep copies of the given rows, for optimistic rollback. */
  function snapshot(ids) {
    const snap = Object.create(null);
    for (const id of ids) {
      if (rows[id]) { snap[id] = cloneRow(rows[id]); }
    }
    return snap;
  }

  /*
   * Puts a snapshot back. Also re-inserts rows that were dropped since it was
   * taken, which is what makes a failed delete recoverable: the optimistic path
   * removes the row outright, so a rollback that only overwrote survivors would
   * restore nothing.
   */
  function restore(snap) {
    for (const id of Object.keys(snap)) { rows[id] = snap[id]; }
    notify(ROWS, GROUPS);
  }

  // ---- selection -------------------------------------------------------------
  function isSelected(id) {
    return !!selected[id];
  }

  function selectedIds() {
    return Object.keys(selected).filter(function (id) { return selected[id] && rows[id]; });
  }

  function setSelected(id, on) {
    if (on) { selected[id] = true; } else { delete selected[id]; }
    notify(SELECTION);
  }

  function clearSelection() {
    for (const id of Object.keys(selected)) { delete selected[id]; }
    notify(SELECTION);
  }

  function selectMany(ids) {
    for (const id of ids) { selected[id] = true; }
    notify(SELECTION);
  }

  // ---- groups ----------------------------------------------------------------
  /*
   * The enabled map is authoritative only for a source that has nowhere else to
   * keep it. Two of the three do: poi/state.js owns the pin catalogue's category
   * and type toggles, and discoveries/state.js owns (and persists) its kind
   * toggles, because in both cases the layer that draws the markers reads them
   * directly. Those adapters therefore answer isGroupEnabled from their own
   * state and never touch this map, which stays empty for them.
   */
  function setGroups(list) {
    groupList = list || [];
    for (const g of groupList) {
      if (groupEnabled[g.id] === undefined) { groupEnabled[g.id] = true; }
    }
    notify(GROUPS, ROWS);
  }

  function groups() {
    return groupList;
  }

  /** The group record, or a grey stand-in so an unknown slug still renders. */
  function group(id) {
    for (const g of groupList) {
      if (g.id === id) { return g; }
    }
    return {
      id: id,
      label: UNKNOWN_GROUP.label || id,
      icon: UNKNOWN_GROUP.icon,
      color: UNKNOWN_GROUP.color,
      sort_order: UNKNOWN_GROUP.sort_order
    };
  }

  function isGroupEnabled(id) {
    return groupEnabled[id] !== false;
  }

  function setGroupEnabled(id, on) {
    const next = on !== false;
    if (groupEnabled[id] === next) { return; }
    groupEnabled[id] = next;
    notify(GROUPS, ROWS);
  }

  function setGroupsEnabled(map) {
    for (const id of Object.keys(map)) { groupEnabled[id] = map[id] !== false; }
    notify(GROUPS, ROWS);
  }

  function groupEnabledMap() {
    const out = {};
    for (const id of Object.keys(groupEnabled)) { out[id] = groupEnabled[id] !== false; }
    return out;
  }

  // ---- view state ------------------------------------------------------------
  function getView() {
    return view;
  }

  function setView(patch) {
    let changed = false;
    for (const k of Object.keys(patch)) {
      if (view[k] !== patch[k]) { view[k] = patch[k]; changed = true; }
    }
    if (changed) { notify(VIEW); }
    return changed;
  }

  /** Marks the map layer / row visibility dirty as well as the view. */
  function setLayerOn(on) {
    if (view.layerOn === on) { return; }
    view.layerOn = on;
    notify(VIEW, ROWS);
  }

  /*
   * Whether this row earns a marker right now. Not a list filter — see list.js.
   * The group toggle first, then the global query (map/query.js): a row hidden
   * by its own toggle stays hidden no matter what is typed, same order every
   * other layer's own visibility predicate uses.
   */
  function rowVisible(row) {
    if (!view.layerOn) { return false; }
    if (!isActiveRow(row)) { return false; }
    if (!isGroupEnabled(groupOfRow(row))) { return false; }
    return matches(searchTextOf(row));
  }

  // ---- inline rename ---------------------------------------------------------
  function getRename() {
    return rename;
  }

  /**
   * Opens inline rename on a row.
   *
   * @param id the row being renamed. It MUST be in this store — see the
   *   invariant at the top of the file. The list reads its row data from
   *   `source.rows()`, so it cannot see that requirement; hence the boolean.
   * @param draft the text to start from. The caller passes it because only the
   *   source knows which field is the title (`field.primary`); the fallback is
   *   for a row that happens to carry a plain `name`.
   * @returns whether rename started. False means the id is not in this store, so
   *   nothing could have saved it either — better a caller that can say so than
   *   an input that accepts a new name and quietly discards it.
   */
  function beginRename(id, draft) {
    const row = rows[id];
    if (!row) {
      /*
       * Unreachable for a correct source: every renameable row is adopted here,
       * and a tombstoned one is still held (which is what makes Undo a write
       * rather than a guess). So this only fires for an adapter that keeps its
       * rows somewhere else, and the symptom it would otherwise present is ✎
       * doing nothing at all — a bug with no error attached to it. Named here so
       * it is found while the adapter is being written.
       */
      console.warn("registry/store: cannot rename " + id +
        " — the row is not in this source's store. A source whose rows can be " +
        "edited must adopt them by id; the write path (snapshot/mutateRows/" +
        "restore) is built on that cache.");
      return false;
    }
    rename.id = id;
    rename.draft = draft === undefined || draft === null ? (row.name || "") : String(draft);
    rename.caret = null; // null = "select the whole name"
    notify(VIEW);
    return true;
  }

  function updateRenameDraft(text, caretStart, caretEnd) {
    rename.draft = text;
    rename.caret = { start: caretStart, end: caretEnd };
    // Deliberately NOT notifying: the input already shows this text, and a
    // render here would fight the user's own typing.
  }

  function endRename() {
    if (rename.id === null) { return; }
    rename.id = null;
    rename.draft = "";
    rename.caret = null;
    notify(VIEW);
  }

  return {
    subscribe: subscribe,
    notify: notify,
    flushNow: flushNow,

    getRow: getRow,
    allRows: allRows,
    activeRows: activeRows,
    rowIds: rowIds,
    adoptRows: adoptRows,
    mutateRows: mutateRows,
    putRow: putRow,
    dropRow: dropRow,
    snapshot: snapshot,
    restore: restore,

    isSelected: isSelected,
    selectedIds: selectedIds,
    setSelected: setSelected,
    clearSelection: clearSelection,
    selectMany: selectMany,

    setGroups: setGroups,
    groups: groups,
    group: group,
    isGroupEnabled: isGroupEnabled,
    setGroupEnabled: setGroupEnabled,
    setGroupsEnabled: setGroupsEnabled,
    groupEnabledMap: groupEnabledMap,

    getView: getView,
    setView: setView,
    setLayerOn: setLayerOn,
    rowVisible: rowVisible,

    getRename: getRename,
    beginRename: beginRename,
    updateRenameDraft: updateRenameDraft,
    endRename: endRename
  };
}
