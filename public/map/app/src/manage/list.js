/*
 * The row list inside the manager panel — one implementation for every source.
 *
 * Generalised from bookmarks/list.js, which was written for bookmarks alone.
 * The two rules that file existed to keep are the two rules this one keeps:
 *
 * 1. A REBUILD MUST NOT EAT AN EDIT. The list rebuilds whenever rows change —
 *    including a background poll that picked up another client's edit. The
 *    inline rename editor is therefore rendered FROM STORE STATE (id + draft +
 *    caret), so a rebuild reconstructs it and puts the caret back. An <input>
 *    holding the only copy of what the user typed is a data-loss bug waiting
 *    for a poll.
 * 2. SELECTION MUST NOT REBUILD. Ticking a checkbox only touches that row's
 *    class and its box. A full re-render on every click detaches the very row
 *    being clicked, throwing away focus, scroll position and mid-click state.
 *
 * A third rule arrives with going generic: NOTHING HERE BRANCHES ON source.id.
 * What a source may do comes from `source.can`, what it shows from its
 * accessors, and anything genuinely its own from `source.rowActions`. One set
 * of delegated listeners serves every tab; they read the active source out of
 * module state at event time.
 */
import { escapeHtml } from "../util/html.js";
import { TABLER } from "../util/assets.js";
import { mapToWorld } from "../map/projection.js";
import { getYouWorld } from "../you/blip.js";
import { getQuery, isActive, matcher, matches, setQuery, subscribe as subscribeQuery } from "../map/query.js";
import { toast } from "../ui/toast.js";
import { openEditor } from "./editor.js";
import { askConfirm } from "../ui/confirm.js";
import { ROWS, SELECTION, VIEW, GROUPS } from "./store.js";

let listEl = null;
let emptyEl = null;
let shownEl = null;

// The source on screen and its store. Every delegated handler reads these at
// event time, which is what lets one set of listeners serve all three tabs.
let src = null;
let store = null;

// The visible order, so shift-click ranges and keyboard navigation agree with
// what the user can actually see.
let orderedIds = [];

/*
 * HOW MANY ROWS REACH THE DOM.
 *
 * `orderedIds` above is the FULL filtered order and stays that way — select
 * all, shift-ranges, Home/End and arrow navigation are all defined over what
 * the filter admits, not over what happens to be painted. Only the PAINTING is
 * windowed.
 *
 * The catalogue this protects against is the discovery layer: 1,562 rows live,
 * ~12 nodes each, and the publisher's own projection for a fully explored world
 * is 10^4-10^5. Unwindowed that measured a 141 ms rebuild to open the tab and
 * another one per keystroke, plus 23k nodes resident.
 *
 * TWO MODES, because the two views have different shapes:
 *
 *   FLAT (the default) — a true virtual window. Rows are uniform height, so the
 *     range on screen is arithmetic on scrollTop and the rows outside it are
 *     replaced by two spacer divs that keep the scrollbar honest. Cost is
 *     bounded by the VIEWPORT, not by the catalogue: End on 100,000 rows paints
 *     a screenful, not 100,000 rows.
 *   GROUPED — grow-on-scroll from the top, no spacers. Group headings are a
 *     different height from rows, so the arithmetic above does not hold, and
 *     faking it would put the scrollbar and the content out of step. Grouping
 *     is a structural view applied AFTER narrowing, so a growing window is the
 *     proportionate answer there.
 */
const RENDER_CHUNK = 200;
// Rows painted beyond each edge of the viewport, so a flick of the wheel lands
// on real rows rather than on a blank spacer waiting for the scroll handler.
const OVERSCAN = 60;
const DEFAULT_ROW_HEIGHT = 34;

let renderLimit = RENDER_CHUNK; // grouped mode: how far down the list is built
let rowHeight = DEFAULT_ROW_HEIGHT;

/** Back to the top. Any change to WHAT is listed starts from the first chunk. */
function resetWindow() {
  renderLimit = RENDER_CHUNK;
  if (listEl) { listEl.scrollTop = 0; }
}

/**
 * The row range the flat list has to paint, for a given scroll position.
 *
 * `scrollTop` is a PARAMETER rather than read from the element, because the
 * render that needs it has already emptied #mg-list — and an empty scroll
 * container has a scrollTop of 0, so reading it there silently pinned the
 * window to the top of the list no matter where the user had scrolled.
 *
 * Clamped to the ends and widened by OVERSCAN. `rowHeight` is re-measured from
 * a real row on every paint, so a theme or font change corrects itself on the
 * next render instead of needing a constant kept in step with the CSS.
 */
function viewportRange(total, scrollTop) {
  const height = listEl.clientHeight || 400;
  const first = Math.floor(scrollTop / rowHeight) - OVERSCAN;
  const count = Math.ceil(height / rowHeight) + OVERSCAN * 2;
  const start = Math.max(0, Math.min(first, total - count));
  return { start: Math.max(0, start), end: Math.min(total, Math.max(0, start) + count) };
}

// ---- source binding ----------------------------------------------------------
const bound = [];

/*
 * One subscription per source, for the life of the page: the store has no
 * unsubscribe, and a handler that fired for a background tab would repaint the
 * wrong rows into #mg-list. Each handler therefore checks it is still the
 * visible source rather than being torn down and rebuilt on every tab switch.
 */
function bind(source, sourceStore) {
  if (bound.indexOf(source) !== -1) { return; }
  bound.push(source);

  sourceStore.subscribe([ROWS, GROUPS], function () {
    if (source === src) { renderList(); }
  });
  sourceStore.subscribe([SELECTION], function () {
    if (source === src) { syncAllSelection(); }
  });
  sourceStore.subscribe([VIEW], function () {
    if (source === src) { onViewChange(); }
  });

  // Hovering a row emphasises its marker and vice versa: with 40 pins on screen,
  // "which one is this row?" is the question the panel could not answer. Only
  // sources whose marker layer can highlight one marker offer this.
  if (source.onHot) {
    source.onHot(function (id, entered) {
      if (source !== src || !listEl) { return; }
      const el = listEl.querySelector('[data-mg-id="' + id + '"]');
      if (el) { el.classList.toggle("hot", entered); }
    });
  }
}

/** Points the list at a different source and repaints it from scratch. */
export function setListSource(source, sourceStore) {
  src = source;
  store = sourceStore;
  bind(source, sourceStore);
  // A different source means different content by definition, so the rebuild
  // guard below must not decide the first render after a tab switch is a no-op.
  lastSignature = null;
  lastActive = null;
  resetWindow();
  renderList();
}

// ---- row lookup --------------------------------------------------------------
/*
 * Rows are read from the SOURCE, never from the store: only the adapter knows
 * what a tombstone looks like in its own system, and `rows()` is contracted to
 * return the active ones. A linear scan is fine — it runs per gesture, not per
 * frame, and the alternative is a second index that can go stale.
 */
function rowById(id) {
  if (!src) { return null; }
  for (const row of src.rows()) {
    if (src.rowId(row) === id) { return row; }
  }
  return null;
}

/** The field the inline rename writes to, or null if the source has none. */
function primaryField() {
  for (const f of (src.fields || [])) {
    if (f.primary) { return f; }
  }
  return null;
}

function canRename() {
  return !!(src.can.edit && primaryField());
}

// ---- filtering + sorting -----------------------------------------------------
function sortSpec(key) {
  const sorts = src.sorts || [];
  for (const s of sorts) {
    if (s.value === key) { return s; }
  }
  return sorts[0] || null;
}

function filteredRows() {
  const view = store.getView();

  const rows = src.rows().filter(function (row) {
    const group = src.groupOf(row);
    // #mg-group-filter also drives map visibility (applyMapGroupFilter), so
    // groupFilter and isGroupEnabled stay in step after a dropdown pick. The
    // filter panel can still toggle groups independently — the list mirrors
    // the map so it never offers a marker that cannot be seen.
    if (view.groupFilter && group !== view.groupFilter) { return false; }
    if (!src.isGroupEnabled(group)) { return false; }
    // The global query (map/query.js), not a per-source search field: one
    // query narrows every tab's list and the map at once.
    return matches(src.searchText(row));
  });

  const spec = sortSpec(view.sortKey);
  if (spec) {
    const ctx = { youWorld: getYouWorld() };
    rows.sort(function (a, b) { return spec.compare(a, b, ctx); });
  }
  if (view.sortDesc) { rows.reverse(); }
  return rows;
}

// ---- row rendering -----------------------------------------------------------
/**
 * Escapes `text`, then wraps every match of the GLOBAL query in <mark>.
 *
 * The query itself is a single `/…/i` RegExp (map/query.js); this clones it
 * with the `g` flag so `exec` walks every hit instead of just the first, and
 * guards zero-length matches (a pattern like `a*`) from pinning `lastIndex`
 * and looping forever. An invalid pattern has no compiled matcher to clone —
 * matcher() is then null while the query is still active — so that case falls
 * back to the same literal-substring highlight the box always had.
 */
function highlight(text) {
  const value = text || "";
  if (!isActive()) { return escapeHtml(value); }

  const re = matcher();
  let out = "";
  let at = 0;
  if (re) {
    const global = new RegExp(re.source, "gi");
    let hit;
    while ((hit = global.exec(value)) !== null) {
      out += escapeHtml(value.slice(at, hit.index)) +
        "<mark>" + escapeHtml(hit[0]) + "</mark>";
      at = hit.index + hit[0].length;
      if (hit[0].length === 0) { global.lastIndex++; }
    }
    return out + escapeHtml(value.slice(at));
  }

  const q = getQuery().trim().toLowerCase();
  const lower = value.toLowerCase();
  for (;;) {
    const hit = lower.indexOf(q, at);
    if (hit === -1) { break; }
    out += escapeHtml(value.slice(at, hit)) +
      "<mark>" + escapeHtml(value.slice(hit, hit + q.length)) + "</mark>";
    at = hit + q.length;
  }
  return out + escapeHtml(value.slice(at));
}

function metres(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + " km" : Math.round(n) + " m";
}

/** The source's groups by id, so a row can name its group in one lookup. */
function groupIndex() {
  const byId = Object.create(null);
  for (const g of src.groups()) { byId[g.id] = g; }
  return byId;
}

/** The group record, or a grey stand-in so an unknown slug still renders. */
function groupRecord(id, groups) {
  return groups[id] || { id: id, label: id || "—", color: "#7a7266", icon: "" };
}

function iconTag(name) {
  // The SOURCE resolves icon names — bookmarks and pins have different closed
  // sets of committed SVGs — so an empty name means "this one has no icon",
  // not "fall back to something".
  if (!name) { return ""; }
  return '<img src="' + TABLER + escapeHtml(name) + '.svg" alt="" width="12" height="12" />';
}

function worldOf(row) {
  const ll = src.latLng(row);
  return ll ? mapToWorld(ll.lat, ll.lng) : null;
}

function sqDistance(origin, world) {
  if (!origin || !world) { return Infinity; }
  const dx = world.x - origin.x;
  const dy = world.y - origin.y;
  return dx * dx + dy * dy;
}

function subLine(row, you, groups) {
  const group = groupRecord(src.groupOf(row), groups);
  let sub = '<span class="mg-chip" style="--pin:' + escapeHtml(src.accent(row)) + '">' +
    '<span class="mg-dot"></span>' + iconTag(src.iconName(row)) +
    escapeHtml(group.label) + "</span>";

  const text = src.subtitle(row);
  if (text) { sub += "<span>" + highlight(text) + "</span>"; }

  const world = worldOf(row);
  if (you && world) {
    sub += '<span class="mg-dist" title="Distance from your character">' +
      metres(Math.sqrt(sqDistance(you, world))) + "</span>";
  }
  if (world) {
    sub += '<span class="mg-coords">' + world.x.toFixed(0) + ", " + world.y.toFixed(0) + "</span>";
  }
  return sub;
}

/*
 * The row's quick actions. Everything universal is derived from the source's
 * capabilities; anything genuinely its own — the bookmark star, duplicate —
 * arrives as a declared rowAction, which is how this stays free of id checks.
 */
function quickActions(row) {
  const out = [];
  for (const a of (src.rowActions || [])) {
    out.push({
      act: "row:" + a.id,
      label: a.label,
      title: a.title || a.label,
      danger: !!a.danger,
      on: !!(a.on && a.on(row))
    });
  }
  // Details, not editing: a read-only source still has fields worth reading and
  // a Delete worth reaching, so this is gated on having fields, not on can.edit.
  if ((src.fields || []).length) {
    out.push({ act: "edit", label: "⚙", title: "Open details (Enter)" });
  }
  if (canRename()) {
    out.push({ act: "rename", label: "✎", title: "Rename (F2, or double-click the name)" });
  }
  if (src.latLng(row)) {
    out.push({ act: "copy", label: "⧉", title: "Copy world coordinates" });
  }
  if (src.can.remove) {
    out.push({ act: "del", label: "🗑", title: "Delete (Del)", danger: true });
  }
  return out;
}

function buildRow(row, you, groups) {
  const view = store.getView();
  const rename = store.getRename();
  const id = src.rowId(row);
  const title = src.title(row);

  const el = document.createElement("div");
  el.className = "mg-row" +
    (store.isSelected(id) ? " sel" : "") +
    (view.activeId === id ? " active" : "") +
    (rename.id === id ? " renaming" : "");
  el.dataset.mgId = id;

  // No bulk capability, no selection UI at all — a checkbox that can only ever
  // select one row is a lie about what the panel can do with it.
  if (src.can.bulk) {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = store.isSelected(id);
    cb.dataset.mgCheck = id;
    cb.setAttribute("aria-label", "Select " + (title || "row"));
    el.appendChild(cb);
  }

  const body = document.createElement("div");
  body.className = "mg-body";

  if (rename.id === id) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "mg-rename";
    input.maxLength = 128;
    input.autocomplete = "off";
    input.value = rename.draft;
    input.dataset.mgRename = id;
    body.appendChild(input);
  } else {
    const name = document.createElement("span");
    name.className = "mg-name";
    name.innerHTML = highlight(title || "(unnamed)");
    body.appendChild(name);
  }

  const sub = document.createElement("span");
  sub.className = "mg-sub";
  sub.innerHTML = subLine(row, you, groups);
  body.appendChild(sub);
  el.appendChild(body);

  const tools = document.createElement("div");
  tools.className = "mg-row-tools";
  for (const a of quickActions(row)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mg-icon-btn" + (a.danger ? " danger" : "") + (a.on ? " on" : "");
    btn.dataset.mgAct = a.act;
    btn.dataset.mgId = id;
    btn.title = a.title;
    btn.setAttribute("aria-label", a.title);
    btn.textContent = a.label;
    tools.appendChild(btn);
  }
  el.appendChild(tools);
  return el;
}

function groupHeading(group, n) {
  const head = document.createElement("div");
  head.className = "mg-group";
  head.innerHTML =
    '<span class="mg-chip" style="--pin:' + escapeHtml(group.color || "#7a7266") + '">' +
    '<span class="mg-dot"></span>' + iconTag(group.icon) + escapeHtml(group.label) + "</span>" +
    '<span class="mg-count">' + n + "</span>";
  return head;
}

/*
 * "Nothing yet" and "nothing matches your filter" are different problems with
 * different fixes, and the old panels showed the first message for both — so a
 * forgotten search looked exactly like an empty account. The wording is built
 * from the source's label and capabilities, so a fourth source gets it free.
 */
function renderEmpty(total, shown) {
  if (shown) {
    emptyEl.style.display = "none";
    emptyEl.textContent = "";
    return;
  }
  emptyEl.style.display = "block";
  const what = escapeHtml(src.label.toLowerCase());

  if (!total) {
    emptyEl.innerHTML = "<strong>No " + what + " yet.</strong><br />" +
      (src.can.create
        ? "Turn on <em>Edit</em> and click the map to add one."
        : "They appear here as the game reports them.");
    return;
  }

  emptyEl.innerHTML = "<strong>Nothing matches.</strong><br />" + total + " " + what +
    " are hidden by the search, the group filter or the layer toggles.";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mg-btn";
  btn.textContent = "Clear filters";
  btn.addEventListener("click", function () {
    // The group toggles are shared with the filter panel and hide rows here too,
    // so a "clear filters" that left them off would leave the list just as empty
    // and the button would look broken. The query is global — clearing it here
    // also clears #search and every other tab's list, which is the point: one
    // query, one Clear.
    setQuery("");
    store.setView({ groupFilter: "" });
    for (const g of src.groups()) { src.setGroupEnabled(g.id, true); }
  });
  emptyEl.appendChild(btn);
}

// ---- full render -------------------------------------------------------------
/**
 * The range this render painted — `[paintedStart, paintedEnd)` into
 * `orderedIds`. The scroll handler compares the range it WANTS against this to
 * decide whether a re-render is needed at all, so scrolling inside the
 * overscan costs one comparison.
 */
let paintedStart = 0;
let paintedEnd = 0;

/** A spacer standing in for `n` unpainted rows, so the scrollbar stays honest. */
function spacer(n) {
  const div = document.createElement("div");
  div.className = "mg-spacer";
  div.style.height = (n * rowHeight) + "px";
  return div;
}

function renderList() {
  if (!listEl || !src) { return; }
  const view = store.getView();
  /*
   * A CLOSED PANEL PAINTS NOTHING.
   *
   * The panel is one aside that starts closed, and this list used to be built
   * anyway — measured live: 1,050 .mg-row nodes in the DOM behind
   * `display: none`, rebuilt on every ROWS notification, for a panel the user
   * had never opened. Everything that reads the list needs it open (it is where
   * the rows, the keyboard layer and the selection live), so there is nothing
   * to keep warm. `panelOpen` is part of the render signature below, so opening
   * the panel paints it.
   */
  if (!view.panelOpen) {
    // Clear rather than merely skip: the rows are worth ~12 nodes each and a
    // closed panel is the normal state of this page.
    listEl.textContent = "";
    paintedStart = 0;
    paintedEnd = 0;
    return;
  }
  const you = getYouWorld();
  const groups = groupIndex();
  const rows = filteredRows();
  const total = src.rows().length;

  orderedIds = rows.map(function (r) { return src.rowId(r); });
  // Captured BEFORE the clear and restored after the spacers are back: emptying
  // a scroll container collapses its scrollHeight, and the browser clamps
  // scrollTop to 0 with it.
  const keepScroll = listEl.scrollTop;
  listEl.textContent = "";

  if (view.group) {
    // Grouped: grow-on-scroll from the top, no spacers. See the window block.
    const end = Math.min(rows.length, renderLimit);
    const counts = Object.create(null);
    for (const row of rows) {
      const g = src.groupOf(row);
      counts[g] = (counts[g] || 0) + 1;
    }
    let currentId = null;
    let bucket = null;
    // Rows are already ordered; headings are inserted as the group changes, so
    // grouping never reorders what the sort decided. The heading COUNT is the
    // group's full size, not how much of it the window reached — a heading that
    // shrank as you scrolled would be reporting on the viewport, not the data.
    for (let i = 0; i < end; i++) {
      const row = rows[i];
      const gid = src.groupOf(row);
      if (gid !== currentId) {
        currentId = gid;
        bucket = document.createElement("div");
        bucket.className = "mg-group-wrap";
        bucket.appendChild(groupHeading(groupRecord(gid, groups), counts[gid]));
        listEl.appendChild(bucket);
      }
      bucket.appendChild(buildRow(row, you, groups));
    }
    paintedStart = 0;
    paintedEnd = end;
  } else {
    // Flat: a true virtual window. Short lists skip the spacers entirely so the
    // common case — a search narrowed to a handful of rows — carries no
    // machinery at all.
    let start = 0;
    let end = rows.length;
    if (rows.length > RENDER_CHUNK) {
      const range = viewportRange(rows.length, keepScroll);
      start = range.start;
      end = range.end;
    }
    if (start > 0) { listEl.appendChild(spacer(start)); }
    for (let i = start; i < end; i++) {
      listEl.appendChild(buildRow(rows[i], you, groups));
    }
    if (end < rows.length) { listEl.appendChild(spacer(rows.length - end)); }
    paintedStart = start;
    paintedEnd = end;

    /*
     * Re-measure from a real row and correct the spacers if the estimate was
     * off. Rows are uniform, so one sample is the answer; doing it here rather
     * than from a constant means the CSS stays the single source of truth for
     * row height.
     */
    const sample = listEl.querySelector(".mg-row");
    if (sample && sample.offsetHeight > 0 && sample.offsetHeight !== rowHeight) {
      rowHeight = sample.offsetHeight;
      for (const sp of listEl.querySelectorAll(".mg-spacer")) {
        const n = sp === listEl.firstChild ? start : rows.length - end;
        sp.style.height = (n * rowHeight) + "px";
      }
    }
    // Last, after the spacers are sized: this is what makes the window survive
    // its own repaint.
    listEl.scrollTop = keepScroll;
  }

  renderEmpty(total, rows.length);
  if (shownEl) {
    // Deliberately reports what the FILTER admits, not what is painted: the
    // window is an implementation detail of scrolling and a number that moved
    // as you scrolled would read as data appearing and disappearing.
    shownEl.textContent = rows.length === total
      ? total + " shown"
      : rows.length + " of " + total + " shown";
  }
  restoreRenameFocus();
}

/*
 * Puts the caret back after a rebuild. `caret === null` means the rename has just
 * started, which is when the whole name should be selected so typing replaces it.
 */
function restoreRenameFocus() {
  const rename = store.getRename();
  if (!rename.id) { return; }
  const input = listEl.querySelector('[data-mg-rename="' + rename.id + '"]');
  if (!input) { return; }
  input.focus();
  if (rename.caret) {
    const end = Math.min(rename.caret.end, input.value.length);
    input.setSelectionRange(Math.min(rename.caret.start, end), end);
  } else {
    input.select();
  }
  const rowEl = input.closest(".mg-row");
  if (rowEl && rowEl.scrollIntoView) { rowEl.scrollIntoView({ block: "nearest" }); }
}

// ---- targeted updates (no rebuild) ------------------------------------------
function syncAllSelection() {
  if (!listEl) { return; }
  for (const el of listEl.querySelectorAll(".mg-row")) {
    const id = el.getAttribute("data-mg-id");
    const on = store.isSelected(id);
    el.classList.toggle("sel", on);
    const box = el.querySelector('input[type="checkbox"]');
    if (box && box.checked !== on) { box.checked = on; }
  }
}

function syncActiveRow() {
  const activeId = store.getView().activeId;
  for (const el of listEl.querySelectorAll(".mg-row")) {
    el.classList.toggle("active", el.getAttribute("data-mg-id") === activeId);
  }
}

/**
 * Brings a row into view, painted or not.
 *
 * A row outside the window has no element to scroll to, so the SCROLL POSITION
 * is moved first — arithmetic on its index, which is what the spacers make
 * valid — and the re-render then paints the range that position implies. This
 * is what keeps End on a 100,000-row list a screenful of work instead of
 * 100,000 rows: the window follows the viewport, it never stretches to reach.
 *
 * It cannot loop: renderList never calls back here.
 */
function scrollToRow(id) {
  if (!listEl) { return; }
  let el = listEl.querySelector('[data-mg-id="' + id + '"]');
  if (!el) {
    const at = orderedIds.indexOf(id);
    if (at < 0) { return; }
    // Centre it rather than putting it hard against an edge: the row is being
    // jumped to, so its neighbours are the context that makes it legible.
    const centred = (at * rowHeight) - (listEl.clientHeight / 2) + (rowHeight / 2);
    listEl.scrollTop = Math.max(0, centred);
    renderList();
    el = listEl.querySelector('[data-mg-id="' + id + '"]');
  }
  if (el && el.scrollIntoView) { el.scrollIntoView({ block: "nearest" }); }
}

// ---- selection gestures -----------------------------------------------------
function selectRange(toId) {
  const from = orderedIds.indexOf(store.getView().anchorId);
  const to = orderedIds.indexOf(toId);
  if (from < 0 || to < 0) {
    store.setSelected(toId, true);
    return;
  }
  store.selectMany(orderedIds.slice(Math.min(from, to), Math.max(from, to) + 1));
}

export function selectAllFiltered() {
  if (src && src.can.bulk) { store.selectMany(orderedIds); }
}

// ---- commands ---------------------------------------------------------------
export function startRename(id) {
  if (!canRename()) { return; }
  const row = rowById(id);
  if (!row) { return; }
  store.setView({ activeId: id });
  // The draft is passed in because the store cannot know which field carries the
  // name; `primary` on the field schema is what says so.
  store.beginRename(id, src.title(row));
}

/*
 * Commits the inline rename. Empty or unchanged names are a no-op rather than an
 * error: a stray Enter should not raise a complaint, and a row must never end up
 * nameless.
 */
function commitRename(id, rawName) {
  const field = primaryField();
  const row = rowById(id);
  store.endRename();
  if (!field || !row) { return; }
  const name = String(rawName || "").trim();
  const values = src.toForm(row);
  if (!name || name === String(values[field.key] === undefined ? "" : values[field.key])) { return; }
  values[field.key] = name;
  // The source owns the optimistic write and its rollback; a rejection here has
  // already been reported by it.
  src.save(id, values).catch(function () {});
}

/*
 * Ported from bookmarks/commands.js: clipboard writes can be refused outright in
 * an embedded browser view, so a failure shows the numbers in the toast to be
 * copied by hand rather than pretending the copy worked.
 */
function copyCoords(id) {
  const row = rowById(id);
  const world = row && worldOf(row);
  if (!world) { return; }
  const text = world.x.toFixed(0) + "," + world.y.toFixed(0);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      toast("Copied " + text, "ok");
    }).catch(function () {
      toast("Coordinates: " + text, "ok");
    });
  } else {
    toast("Coordinates: " + text, "ok");
  }
}

/*
 * The one delete path: the row's 🗑, the Del key and the bulk bar all land here.
 *
 * WHETHER to ask first is the source's call, not the panel's. `removeWarning`
 * returns a sentence for a delete that cannot be undone and null for one that
 * can: bookmarks tombstone and hand back an Undo toast, so a confirm there is
 * only a speed bump; pins issue a real DELETE, so it is not.
 */
export function removeRows(source, ids) {
  if (!source.can.remove || !ids.length) { return; }
  const warning = source.removeWarning ? source.removeWarning(ids) : null;
  if (!warning) {
    // The source owns the optimistic write, its rollback and any toast; a
    // rejection here has already been reported by it.
    source.remove(ids).catch(function () {});
    return;
  }
  askConfirm({
    title: "Delete?", text: warning, confirmLabel: "Delete", danger: true
  }).then(function (yes) {
    if (yes) { source.remove(ids).catch(function () {}); }
  });
}

function runAction(act, id, btn) {
  if (act.indexOf("row:") === 0) {
    const key = act.slice(4);
    for (const a of (src.rowActions || [])) {
      if (a.id === key) { a.run(id, btn); return; }
    }
    return;
  }
  switch (act) {
    case "edit": openEditor(src, id); break;
    case "rename": startRename(id); break;
    case "copy": copyCoords(id); break;
    case "del": removeRows(src, [id]); break;
  }
}

// ---- keyboard ---------------------------------------------------------------
function focusRow(index, extend) {
  const id = orderedIds[Math.min(orderedIds.length - 1, Math.max(0, index))];
  if (!id) { return; }
  if (extend && src.can.bulk) {
    store.setView({ activeId: id });
    selectRange(id);
  } else {
    store.setView({ activeId: id, anchorId: id });
  }
}

/* A cursor that the filter has hidden starts again from the end it came from. */
function moveActive(delta, extend) {
  const at = orderedIds.indexOf(store.getView().activeId);
  focusRow(at === -1 ? (delta > 0 ? 0 : orderedIds.length - 1) : at + delta, extend);
}

/*
 * The list's half of the panel-wide key layer. panel.js owns the listener —
 * Escape and the panel's own keys are its business — and hands every key here
 * first, because everything that moves within the rows belongs next to the
 * visible order it depends on. Returns true when the key was consumed.
 */
export function handleListKey(e) {
  if (!src || !listEl) { return false; }

  // Anything the user is typing into owns its own keys; the one exception is
  // walking out of the search box and down into the results, which is the
  // gesture that makes "type, then arrow to it" work without the mouse.
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    if (!(e.key === "ArrowDown" && e.target.id === "mg-search")) { return false; }
  }
  if (!orderedIds.length) { return false; }

  const view = store.getView();
  switch (e.key) {
    case "ArrowDown": moveActive(1, e.shiftKey); return true;
    case "ArrowUp": moveActive(-1, e.shiftKey); return true;
    case "Home": focusRow(0, e.shiftKey); return true;
    case "End": focusRow(orderedIds.length - 1, e.shiftKey); return true;
    case "Enter":
      if (!view.activeId || !(src.fields || []).length) { return false; }
      openEditor(src, view.activeId);
      return true;
    case "F2":
      if (!view.activeId) { return false; }
      startRename(view.activeId);
      return true;
    case "Delete": {
      if (!src.can.remove) { return false; }
      // The selection is what the bulk bar shows; with nothing ticked, Del means
      // the row under the cursor.
      const ids = src.can.bulk && store.selectedIds().length
        ? store.selectedIds()
        : (view.activeId ? [view.activeId] : []);
      if (!ids.length) { return false; }
      removeRows(src, ids);
      return true;
    }
    case " ":
      if (!src.can.bulk || !view.activeId) { return false; }
      store.setSelected(view.activeId, !store.isSelected(view.activeId));
      store.setView({ anchorId: view.activeId });
      return true;
    case "a":
    case "A":
      if (!src.can.bulk || !(e.ctrlKey || e.metaKey)) { return false; }
      selectAllFiltered();
      return true;
    default:
      return false;
  }
}

// ---- wiring -----------------------------------------------------------------
export function wireList() {
  listEl = document.getElementById("mg-list");
  emptyEl = document.getElementById("mg-empty");
  shownEl = document.getElementById("mg-shown");

  listEl.addEventListener("click", function (e) {
    if (!src) { return; }

    const act = e.target.closest("[data-mg-act]");
    if (act) {
      runAction(act.getAttribute("data-mg-act"), act.getAttribute("data-mg-id"), act);
      return;
    }

    const check = e.target.closest("[data-mg-check]");
    if (check) {
      const id = check.getAttribute("data-mg-check");
      store.setSelected(id, check.checked);
      store.setView({ anchorId: id });
      return;
    }

    // A click inside the rename editor is not a row click.
    if (e.target.closest("[data-mg-rename]")) { return; }

    const rowEl = e.target.closest("[data-mg-id]");
    if (!rowEl) { return; }
    const id = rowEl.getAttribute("data-mg-id");

    if (e.shiftKey && src.can.bulk) { selectRange(id); return; }
    if ((e.ctrlKey || e.metaKey) && src.can.bulk) {
      store.setSelected(id, !store.isSelected(id));
      store.setView({ anchorId: id });
      return;
    }
    // A plain row click also anchors the next shift-click range — otherwise
    // "click one, shift-click another" selects only the second row, which is not
    // what any list in the world does.
    store.setView({ activeId: id, anchorId: id });
    src.reveal(id);
  });

  // Double-click to rename: the gesture every file manager already taught users.
  listEl.addEventListener("dblclick", function (e) {
    if (!src || e.target.closest("[data-mg-rename]")) { return; }
    const rowEl = e.target.closest("[data-mg-id]");
    if (!rowEl) { return; }
    e.preventDefault();
    startRename(rowEl.getAttribute("data-mg-id"));
  });

  // Mirror the typed text into the store WITHOUT notifying, so the draft survives
  // a rebuild but the user's own keystrokes never trigger one.
  listEl.addEventListener("input", function (e) {
    const input = e.target.closest("[data-mg-rename]");
    if (!input || !src) { return; }
    store.updateRenameDraft(input.value, input.selectionStart, input.selectionEnd);
  });

  listEl.addEventListener("keydown", function (e) {
    const input = e.target.closest("[data-mg-rename]");
    if (!input || !src) { return; }
    // The rename editor owns these keys; the panel-wide layer must not also act.
    e.stopPropagation();
    const id = input.getAttribute("data-mg-rename");
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename(id, input.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      store.endRename();
    } else if (e.key === "Tab") {
      // Commit and step to the next row's name: renaming a batch without
      // reaching for the mouse is the whole point of "easy rename".
      e.preventDefault();
      const at = orderedIds.indexOf(id);
      commitRename(id, input.value);
      const next = orderedIds[at + (e.shiftKey ? -1 : 1)];
      if (next) { startRename(next); }
    }
  });

  /*
   * Blur commits — but a rebuild also blurs, so the check is deferred a tick and
   * then verifies the focus did NOT come back to the same editor. Without that,
   * a poll landing mid-rename would commit a half-typed name.
   */
  listEl.addEventListener("focusout", function (e) {
    const input = e.target.closest("[data-mg-rename]");
    if (!input || !src) { return; }
    const id = input.getAttribute("data-mg-rename");
    const value = input.value;
    window.setTimeout(function () {
      if (!src || store.getRename().id !== id) { return; }
      const active = document.activeElement;
      if (active && active.getAttribute && active.getAttribute("data-mg-rename") === id) { return; }
      commitRename(id, value);
    }, 0);
  });

  listEl.addEventListener("mouseover", function (e) {
    if (!src || !src.setHot) { return; }
    const rowEl = e.target.closest("[data-mg-id]");
    src.setHot(rowEl ? rowEl.getAttribute("data-mg-id") : null);
  });
  listEl.addEventListener("mouseleave", function () {
    if (src && src.setHot) { src.setHot(null); }
  });

  /*
   * Scrolling drives the window, differently per mode (see the window block).
   *
   * FLAT: re-render only when the viewport has moved OUTSIDE the range already
   * painted. Inside the overscan a scroll costs two comparisons, which is what
   * keeps wheel scrolling smooth — the repaint happens once per ~60 rows
   * travelled, not once per event.
   *
   * GROUPED: grow by a chunk when the bottom comes into reach, with 400 px of
   * lead so the rows exist before the scrollbar runs out.
   */
  listEl.addEventListener("scroll", function () {
    if (!src || !store) { return; }
    if (store.getView().group) {
      if (paintedEnd >= orderedIds.length) { return; }
      if (listEl.scrollTop + listEl.clientHeight < listEl.scrollHeight - 400) { return; }
      renderLimit = paintedEnd + RENDER_CHUNK;
      renderList();
      return;
    }
    if (orderedIds.length <= RENDER_CHUNK) { return; }
    const want = viewportRange(orderedIds.length, listEl.scrollTop);
    if (want.start >= paintedStart && want.end <= paintedEnd) { return; }
    renderList();
  });

  // The query is GLOBAL — it can change while a source's own VIEW channel
  // stays silent (typing in #search touches no store at all) — so the list
  // has to listen for it directly rather than only through a source's VIEW
  // subscription. signature() below folds the query text in, so this reaches
  // the same rebuild-or-reposition decision onViewChange always makes.
  subscribeQuery(function () {
    if (src) { onViewChange(); }
  });
}

/*
 * A VIEW notification does not always mean the list changed. Rebuild only when
 * something that alters the list's CONTENT or ORDER moved; a moved cursor just
 * repaints one class, which is what keeps arrow-key navigation smooth — and,
 * more importantly, is what stops a click on a row detaching that very row.
 */
let lastSignature = null;
let lastActive = null;

function signature() {
  const v = store.getView();
  // panelOpen is in here because renderList refuses to paint a closed panel:
  // opening it has to be a content change, or the list stays empty until the
  // next poll happens to move something. getQuery() is here instead of
  // v.search: the query moved out of the per-source view (map/query.js), but
  // the list still has to repaint when it changes.
  return [getQuery(), v.groupFilter, v.sortKey, v.sortDesc, v.group, v.panelOpen,
    store.getRename().id].join("\u0001");
}

function onViewChange() {
  const sig = signature();
  if (sig !== lastSignature) {
    lastSignature = sig;
    // A new search, sort or filter is a new list; keeping a window the user
    // scrolled open on the PREVIOUS one would paint hundreds of rows they never
    // asked to see, which is the cost this window exists to avoid.
    resetWindow();
    lastActive = store.getView().activeId;
    renderList();
    return;
  }
  if (store.getView().activeId !== lastActive) {
    lastActive = store.getView().activeId;
    syncActiveRow();
    if (lastActive) { scrollToRow(lastActive); }
  }
}
