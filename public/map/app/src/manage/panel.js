/*
 * The manager shell: the tab strip, the toolbar, the selection bar and the
 * panel's own chrome. The rows themselves are list.js's problem.
 *
 * There used to be two and a half of these — the bookmark panel, the POI filter
 * panel plus its right-side editor, and nothing at all for discoveries — so the
 * same three questions ("what is there", "which of it do I want to see", "do
 * this to those") had three different answers depending on which kind of marker
 * you happened to be looking at. This file answers them once.
 *
 * The rule that keeps it honest: NOTHING HERE BRANCHES ON source.id. Which
 * controls exist is decided by `source.can`, what they are filled with by
 * `source.groups()` / `source.sorts` / `source.bulkActions`, and a fourth
 * source would light the panel up without this file changing.
 */
import { TABLER } from "../util/assets.js";
import { openMenu, pickerOpen } from "../ui/picker.js";
import {
  sources, storeFor, activeId, activeSource, setActive, onActiveChange
} from "./sources-registry.js";
import { ROWS, SELECTION, VIEW, GROUPS } from "./store.js";
import { openEditor } from "./editor.js";
import {
  wireList, setListSource, selectAllFiltered, removeRows, startRename, handleListKey
} from "./list.js";
import { applyMapGroupFilter } from "./filters.js";
import { getQuery, setQuery, subscribe as subscribeQuery } from "../map/query.js";

const el = {};

// See the #mg-search listener in mount() for why both of these exist.
const SEARCH_DEBOUNCE_MS = 150;
let searchTimer = null;

function cache() {
  el.panel = document.getElementById("manage-panel");
  el.tabs = document.getElementById("mg-tabs");
  el.search = document.getElementById("mg-search");
  el.groupFilter = document.getElementById("mg-group-filter");
  el.sort = document.getElementById("mg-sort");
  el.sortDir = document.getElementById("mg-sort-dir");
  el.groupBtn = document.getElementById("mg-group");
  el.selTools = document.getElementById("mg-seltools");
  el.selBar = document.getElementById("mg-selbar");
  el.selCount = document.getElementById("mg-selcount");
  el.selectAll = document.getElementById("mg-select-all");
  el.clearSel = document.getElementById("mg-clear-sel");
  el.toggle = document.getElementById("manage-toggle");
  el.badge = document.getElementById("manage-badge");
  el.editToggle = document.getElementById("manage-edit-toggle");
  el.refresh = document.getElementById("mg-refresh");
  el.forgetKey = document.getElementById("mg-forget-key");
  el.close = document.getElementById("mg-close");
  el.backdrop = document.getElementById("manage-backdrop");
}

function currentStore() {
  const source = activeSource();
  return source ? storeFor(source.id) : null;
}

function actionButton(label, extra, run) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mg-btn" + (extra ? " " + extra : "");
  btn.textContent = label;
  btn.addEventListener("click", function () { run(btn); });
  return btn;
}

// ---- tabs --------------------------------------------------------------------
function buildTabs() {
  el.tabs.textContent = "";
  for (const source of sources()) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mg-tab";
    btn.dataset.mgTab = source.id;
    btn.setAttribute("role", "tab");

    if (source.icon) {
      const img = document.createElement("img");
      img.className = "mg-tab-ico";
      // The source resolves its own icon name: bookmarks and pins have separate
      // closed sets of committed SVGs and a shared alias table would 404.
      img.src = TABLER + source.icon + ".svg";
      img.alt = "";
      img.width = 14;
      img.height = 14;
      btn.appendChild(img);
    }

    const label = document.createElement("span");
    label.textContent = source.label;
    btn.appendChild(label);

    const count = document.createElement("span");
    count.className = "mg-tab-count";
    count.dataset.mgCount = source.id;
    btn.appendChild(count);

    el.tabs.appendChild(btn);
  }
  syncTabs();
}

/*
 * Tab counts are live, not a snapshot taken when the panel opened: EVERY
 * source's ROWS channel repaints them, so "Discoveries 41" ticks up while you
 * are reading the bookmark tab. That number is the only reason anyone would
 * think to switch tabs, so it has to be true even while the tab is in the back.
 */
function syncTabs() {
  const id = activeId();
  for (const btn of el.tabs.querySelectorAll("[data-mg-tab]")) {
    const on = btn.getAttribute("data-mg-tab") === id;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  }
  for (const source of sources()) {
    const cell = el.tabs.querySelector('[data-mg-count="' + source.id + '"]');
    if (cell) { cell.textContent = String(source.rows().length); }
  }
  const active = activeSource();
  // The button on the map shows the tab you would land on, so opening the panel
  // never contradicts the number that made you open it.
  if (el.badge) { el.badge.textContent = active ? String(active.rows().length) : "0"; }
}

// ---- toolbar -----------------------------------------------------------------
/*
 * The group filter and the sort are picker BUTTONS, not <select>s.
 *
 * This page can be embedded in an in-app web view, where a native
 * <select> popup does not open at all — the POI editor found that first and
 * ui/picker.js exists because of it. Two silent dead controls in the
 * middle of the toolbar would be the least reliable part of the new manager, in
 * the client most likely to use it.
 */
function groupItems(source, store) {
  const chosen = store.getView().groupFilter || "";
  const items = [{ value: "", label: "All groups", active: !chosen }];
  for (const g of source.groups()) {
    items.push({
      // A group whose count the source did not compute is still selectable; a
      // literal "(undefined)" in the menu is not.
      value: g.id,
      label: g.count === undefined ? g.label : g.label + " (" + g.count + ")",
      color: g.color,
      active: chosen === g.id
    });
  }
  return items;
}

function setPickLabel(btn, text, placeholder) {
  const val = btn.querySelector(".val");
  if (!val) { return; }
  val.textContent = text;
  val.classList.toggle("placeholder", !!placeholder);
}

function buildToolbar(source, store) {
  // A group can disappear under a saved filter — a category deleted elsewhere,
  // a discovery class that stopped being reported. Left alone the panel would
  // filter everything out and blame the user's search, so drop back to "all".
  const chosen = store.getView().groupFilter;
  if (chosen && !source.groups().some(function (g) { return g.id === chosen; })) {
    store.setView({ groupFilter: "" });
  }

  const sorts = source.sorts || [];
  if (sorts.length && !sorts.some(function (s) { return s.value === store.getView().sortKey; })) {
    store.setView({ sortKey: sorts[0].value });
  }

  // Edit mode is drag-and-create; a source that offers neither has no use for
  // the button, and an inert button is worse than no button.
  if (el.editToggle) {
    el.editToggle.style.display = (source.can.drag || source.can.create) ? "" : "none";
  }
  syncControls();
}

/** Reflects the active source's view state back onto the toolbar controls. */
function syncControls() {
  const source = activeSource();
  const store = currentStore();
  if (!source || !store) { return; }
  const v = store.getView();

  // searchTimer !== null means the box holds newer text than the query does.
  // The query is GLOBAL now (map/query.js), not per-source view state, so this
  // also mirrors a keystroke typed into the OTHER search box, #search.
  if (el.search && searchTimer === null && el.search.value !== getQuery()) {
    el.search.value = getQuery();
  }

  if (el.groupFilter) {
    const group = source.groups().filter(function (g) { return g.id === v.groupFilter; })[0];
    setPickLabel(el.groupFilter, group ? group.label : "All groups", !group);
    el.groupFilter.classList.toggle("active", !!v.groupFilter);
  }
  if (el.sort) {
    const sort = (source.sorts || []).filter(function (s) { return s.value === v.sortKey; })[0];
    setPickLabel(el.sort, sort ? sort.label : "Sort", !sort);
  }
  if (el.sortDir) {
    el.sortDir.textContent = v.sortDesc ? "↓" : "↑";
    el.sortDir.title = v.sortDesc ? "Descending" : "Ascending";
    el.sortDir.classList.toggle("active", !!v.sortDesc);
  }
  if (el.groupBtn) { el.groupBtn.classList.toggle("active", !!v.group); }
  // The body class and the actual dragging belong to each source's marker layer,
  // which subscribes to VIEW itself; the panel only owns the button.
  if (el.editToggle) { el.editToggle.classList.toggle("active", !!v.editMode); }
}

// ---- selection bar -----------------------------------------------------------
/*
 * Built from capabilities, never from a fixed list of buttons.
 *
 * can.bulk false means NO selection UI at all — no checkboxes in the rows, no
 * "select all filtered", no bar. A multi-select that can only ever act on one
 * row at a time is a promise the panel cannot keep, and pins are exactly that
 * case today: there is no bulk pin route and inventing one is out of scope.
 * can.remove false drops Delete. Anything else a source wants here it declares
 * as a bulkAction, which is why this function never asks who it is talking to.
 */
function buildSelBar(source, store) {
  const bulk = !!source.can.bulk;
  /*
   * Both bars are driven by the `open` CLASS, never an inline display.
   * manage.css hides #mg-seltools by default and shows it on `.open`, so
   * clearing the inline style here does not reveal it — it falls back to the
   * hidden default. That mismatch shipped once: bookmarks had 41 checkboxes and
   * no "Select all" above them.
   *
   * The two differ in WHEN they open. The tools row tracks the capability, so
   * it is there as soon as a source can do bulk work; the bar below it tracks
   * the selection, so it appears only once something is ticked.
   */
  el.selTools.classList.toggle("open", bulk);
  el.selBar.style.display = "";

  // #mg-selcount is frozen markup; everything after it is ours to replace.
  while (el.selCount.nextSibling) { el.selBar.removeChild(el.selCount.nextSibling); }
  if (!bulk) {
    el.selBar.classList.remove("open");
    return;
  }

  for (const a of (source.bulkActions || [])) {
    el.selBar.appendChild(actionButton(a.label, "", function (btn) {
      // The button goes through because these open a picker anchored to it.
      a.run(store.selectedIds(), btn);
    }));
  }
  if (source.can.remove) {
    el.selBar.appendChild(actionButton("Delete", "danger", function () {
      removeRows(source, store.selectedIds());
    }));
  }
}

function syncSelBar() {
  const source = activeSource();
  const store = currentStore();
  if (!source || !store) { return; }
  if (!source.can.bulk) { el.selBar.classList.remove("open"); return; }
  const n = store.selectedIds().length;
  el.selCount.textContent = n === 1 ? "1 selected" : n + " selected";
  el.selBar.classList.toggle("open", n > 0);
}

// ---- open / close ------------------------------------------------------------
/*
 * Open state is written to EVERY source's view, not just the active one. The
 * panel is one panel; a per-tab "is it open" would have it shut itself halfway
 * through a tab switch because the tab you arrived at was last seen closed.
 */
function setPanelOpen(on) {
  for (const source of sources()) { storeFor(source.id).setView({ panelOpen: on }); }
  el.panel.classList.toggle("open", on);
  if (el.toggle) { el.toggle.classList.toggle("active", on); }
}

/*
 * Marker popups call back into the manager.
 *
 * A popup's Edit / Rename / Delete are the SAME three commands the list row
 * offers, so they route to the same code rather than growing a second
 * implementation that drifts. Each one first makes its source the active tab:
 * you clicked a bookmark, so the manager should be showing bookmarks — and
 * inline rename in particular happens inside the list, so renaming from a popup
 * only means anything if the row it edits is on screen.
 */
function popupActionsFor(source) {
  return {
    edit: function (id) {
      setActive(source.id);
      openEditor(source, id);
    },
    rename: function (id) {
      setActive(source.id);
      setPanelOpen(true);
      startRename(id);
    },
    remove: function (id) {
      setActive(source.id);
      removeRows(source, [id]);
    }
  };
}

// ---- active source -----------------------------------------------------------
function applyActive() {
  const source = activeSource();
  if (!source) { return; }
  // A pending keystroke belongs to the tab being left. Applying it to the tab
  // being entered would filter a list the user has not even seen yet.
  if (searchTimer !== null) { window.clearTimeout(searchTimer); searchTimer = null; }
  const store = storeFor(source.id);
  buildToolbar(source, store);
  buildSelBar(source, store);
  syncTabs();
  syncControls();
  syncSelBar();
  setListSource(source, store);
}

const bound = [];

/*
 * One subscription per source for the life of the page. The store has no
 * unsubscribe, so instead of tearing handlers down on every tab switch each one
 * asks whether it is still the visible source — except the count, which is
 * deliberately global.
 */
function bindSource(source) {
  if (bound.indexOf(source) !== -1) { return; }
  bound.push(source);
  const store = storeFor(source.id);

  store.subscribe([ROWS], syncTabs);
  store.subscribe([GROUPS], function () {
    syncTabs();
    // The group filter's options carry counts, so a moved taxonomy rebuilds it —
    // but only for the tab actually on screen.
    if (source === activeSource()) { buildToolbar(source, store); }
  });
  store.subscribe([SELECTION], function () {
    if (source === activeSource()) { syncSelBar(); }
  });
  store.subscribe([VIEW], function () {
    if (source === activeSource()) { syncControls(); }
  });
}

// ---- wiring ------------------------------------------------------------------
/** Call once, after every source has been registered. */
export function mount() {
  cache();
  wireList();

  for (const source of sources()) {
    bindSource(source);
    // A source with no marker popup simply does not declare this.
    if (source.setPopupActions) { source.setPopupActions(popupActionsFor(source)); }
  }
  buildTabs();

  el.tabs.addEventListener("click", function (e) {
    const btn = e.target.closest("[data-mg-tab]");
    if (btn) { setActive(btn.getAttribute("data-mg-tab")); }
  });

  el.toggle.addEventListener("click", function () {
    setPanelOpen(!el.panel.classList.contains("open"));
  });
  el.close.addEventListener("click", function () { setPanelOpen(false); });

  /*
   * The backdrop is raised and lowered by the editor, not by the panel. The
   * panel only borrows a click on it, and only while the editor is down, so the
   * editor's own click-outside-to-close always wins.
   */
  if (el.backdrop) {
    el.backdrop.addEventListener("click", function () {
      const editor = document.getElementById("manage-editor");
      if (editor && editor.classList.contains("open")) { return; }
      setPanelOpen(false);
    });
  }

  el.editToggle.addEventListener("click", function () {
    const store = currentStore();
    if (store) { store.setView({ editMode: !store.getView().editMode }); }
  });

  el.refresh.addEventListener("click", function () {
    const source = activeSource();
    if (!source) { return; }
    el.refresh.disabled = true;
    // A second load() is a full re-read — cursor reset and all — which is the
    // difference between this button and waiting for the next poll.
    source.load().catch(function () {}).then(function () { el.refresh.disabled = false; });
  });

  if (el.forgetKey) {
    el.forgetKey.addEventListener("click", function () {
      // Sources whose routes need no key simply do not declare it. Asking all of
      // them keeps this correct when a fourth one turns up.
      for (const source of sources()) {
        if (source.forgetKey) { source.forgetKey(); }
      }
    });
  }

  /*
   * Search is DEBOUNCED, and syncControls must not fight the debounce.
   *
   * setQuery() re-renders the active list AND the map, which measured 115 ms
   * per keystroke against the live discovery catalogue — every letter typed,
   * with the previous letter's list still being built. 150 ms is under the
   * gap between keystrokes in ordinary typing, so everything updates once when
   * the user pauses rather than once per character.
   *
   * The pending flag exists because syncControls() writes the query BACK into
   * this input on any change — including one that came from #search, since the
   * query is now global (map/query.js) and the two boxes mirror each other.
   * Mid-debounce this input already holds newer text than the query does, so
   * an unrelated notification would otherwise silently undo what was just
   * typed.
   */
  el.search.addEventListener("input", function () {
    const value = this.value;
    if (searchTimer !== null) { window.clearTimeout(searchTimer); }
    searchTimer = window.setTimeout(function () {
      searchTimer = null;
      setQuery(value);
    }, SEARCH_DEBOUNCE_MS);
  });
  el.groupFilter.addEventListener("click", function () {
    const source = activeSource();
    const store = currentStore();
    if (!source || !store) { return; }
    openMenu(el.groupFilter, {
      title: "Show only",
      items: groupItems(source, store),
      onPick: function (value) {
        // List filter AND map layers: picking a group hides every other
        // category on the map (same as the filter panel's Show only).
        store.setView({ groupFilter: value });
        applyMapGroupFilter(source, value);
      }
    });
  });
  el.sort.addEventListener("click", function () {
    const source = activeSource();
    const store = currentStore();
    if (!source || !store) { return; }
    openMenu(el.sort, {
      title: "Sort by",
      items: (source.sorts || []).map(function (s) {
        return { value: s.value, label: s.label, active: store.getView().sortKey === s.value };
      }),
      empty: "This source declares no sort orders.",
      onPick: function (value) { store.setView({ sortKey: value }); }
    });
  });
  if (el.sortDir) {
    el.sortDir.addEventListener("click", function () {
      const store = currentStore();
      if (store) { store.setView({ sortDesc: !store.getView().sortDesc }); }
    });
  }
  if (el.groupBtn) {
    el.groupBtn.addEventListener("click", function () {
      const store = currentStore();
      if (store) { store.setView({ group: !store.getView().group }); }
    });
  }

  el.selectAll.addEventListener("click", selectAllFiltered);
  el.clearSel.addEventListener("click", function () {
    const store = currentStore();
    if (store) { store.clearSelection(); }
  });

  /*
   * The panel-wide key layer. This is the layer the rename editor, the pickers
   * and the editor aside all stop propagation for: they own their keys, and
   * without that guard Del would delete the row someone is editing.
   */
  el.panel.addEventListener("keydown", function (e) {
    if (pickerOpen()) { return; }
    if (handleListKey(e)) { e.preventDefault(); return; }
    if (e.key === "Escape") {
      e.preventDefault();
      // Escape unwinds one step at a time: the selection first, the panel only
      // once there is nothing left to let go of.
      const store = currentStore();
      if (store && store.selectedIds().length) { store.clearSelection(); }
      else { setPanelOpen(false); }
    }
  });

  // #mg-search mirrors #search: a keystroke in either box has to show up in
  // both, and syncControls is what already reflects the query onto this one.
  subscribeQuery(syncControls);
  onActiveChange(applyActive);
  applyActive();

  const store = currentStore();
  setPanelOpen(!!(store && store.getView().panelOpen));
}
