/*
 * The unified filter panel: one section per registered source, inside
 * #filter-sections.
 *
 * This replaces three hand-rolled and mutually inconsistent implementations —
 * poi/filter-panel.js, bookmarks/filter-section.js and
 * discoveries/filter-section.js. All three carried a comment explaining that
 * they were deliberately separate because "the entities share no data and no
 * coordinate frame, and merging their filter UIs would imply they are the same
 * kind of thing". That reasoning was about the DATA and it is still true — but
 * it was applied to the CONTROLS, and there it produced three different answers
 * to "how do I hide a category": one with an expand tree and Show only, one
 * with a layer switch, one with neither. The entities stay separate; the way
 * you operate on them does not.
 *
 * Everything here is driven by the source descriptor. Nothing branches on
 * source.id. Four descriptor members are OPTIONAL, and a source omitting any
 * of them renders cleanly without it:
 *
 *   subGroups(groupId) / isSubGroupEnabled / setSubGroupEnabled
 *       the second level — the pin catalogue's per-type toggles under a
 *       category. Absent means a flat list.
 *   presets  [{ id, label, groupIds }]
 *       the pin catalogue's Travel / Gathering / Finds row. Absent means none.
 *   health() -> { ok, hint }
 *       absent means always healthy. When ok is false the head shows "!"
 *       instead of the count: the rows on screen are still real, they are just
 *       no longer fresh, and a silently stale number is worse than a tell.
 *   aggregate: true
 *       this source's rows are a join over the other sources' rows (the
 *       private repo's own join-tab source — the public build never
 *       registers one), so it renders no section at all: those rows already
 *       have a section each, under their own owner, and a fourth block here
 *       would just repeat their layer toggles.
 *
 * Kept from the three predecessors: the pin panel's Show only and its
 * Show all / Hide all (now across every registered source), the bookmark
 * section's backfill of groups the data has but the taxonomy never declared,
 * and the discovery section's single delegated listener plus aria-pressed.
 */
import { TABLER } from "../util/assets.js";
import { sources as allSources, get as sourceById } from "../registry/sources-registry.js";
import { isActive as queryActive, matches, subscribe as subscribeQuery } from "../map/query.js";

// Expansion and the active preset are presentation, not data: they belong to
// this panel rather than to any source's store, and they do not outlive a load.
const expanded = Object.create(null);
const activePreset = Object.create(null);
const subscribed = Object.create(null);

let root = null;
let scheduled = false;

function elem(tag, cls) {
  const node = document.createElement(tag);
  if (cls) { node.className = cls; }
  return node;
}

function img(name) {
  const node = document.createElement("img");
  node.src = TABLER + (name || "map-pin") + ".svg";
  node.alt = "";
  return node;
}

function key(sourceId, groupId) {
  return sourceId + "\u0000" + groupId;
}

// ---- optional descriptor members ---------------------------------------------
function subGroupsOf(source, groupId) {
  if (typeof source.subGroups !== "function") { return []; }
  return source.subGroups(groupId) || [];
}

function subOn(source, groupId, subId) {
  return typeof source.isSubGroupEnabled === "function"
    ? !!source.isSubGroupEnabled(groupId, subId)
    : true;
}

function setSubOn(source, groupId, subId, on) {
  if (typeof source.setSubGroupEnabled === "function") {
    source.setSubGroupEnabled(groupId, subId, on);
  }
}

function presetsOf(source) {
  return Array.isArray(source.presets) ? source.presets : [];
}

/**
 * The declared taxonomy first, then any group the data has but the taxonomy
 * never declared. Without the backfill those rows are invisible AND
 * unfilterable, which is the worst of both — you cannot see them and you cannot
 * find out why.
 *
 * @returns {{groups: Array, total: number, matched: number}} total is the row
 *   count for the head; matched is how many of them pass the global query
 *   (equal to total while no query is active, in ONE pass over the rows —
 *   see map/query.js).
 */
function groupsOf(source) {
  const out = [];
  const seen = Object.create(null);
  for (const group of source.groups() || []) {
    seen[group.id] = true;
    out.push(group);
  }
  const extra = Object.create(null);
  let total = 0;
  let matched = 0;
  for (const row of source.rows()) {
    total++;
    if (matches(source.searchText(row))) { matched++; }
    const id = source.groupOf(row);
    if (id === null || id === undefined || seen[id]) { continue; }
    extra[id] = (extra[id] || 0) + 1;
  }
  for (const id of Object.keys(extra)) {
    out.push({ id: id, label: id, color: "", icon: "", count: extra[id] });
  }
  return { groups: out, total: total, matched: matched };
}

// ---- rendering ---------------------------------------------------------------
/*
 * Every control carries a stable key so focus survives the rebuild below. All
 * three old panels re-rendered on click and dropped focus with it, which made
 * the filter panel unusable from the keyboard.
 */
function fkey(node, parts) {
  node.dataset.fkey = parts.join("\u0000");
}

function head(source, total, matched) {
  const bar = elem("div", "mg-fsec-head");

  const ico = elem("span", "mg-fsec-ico");
  ico.appendChild(img(source.icon));
  bar.appendChild(ico);

  const name = elem("strong");
  name.textContent = source.label;
  bar.appendChild(name);

  const count = elem("span", "mg-fsec-count");
  const health = typeof source.health === "function" ? source.health() : null;
  // The "!" health tell takes precedence over the query breakdown: a stale
  // poll is a bigger problem than an uninteresting match count.
  if (health && health.ok === false) {
    count.textContent = "!";
    count.title = health.hint || "Data may be stale.";
  } else if (queryActive()) {
    count.textContent = matched + "/" + total;
    count.title = matched + " of " + total + " " + source.label.toLowerCase() + " match the filter";
  } else {
    count.textContent = String(total);
    count.title = total + " " + source.label.toLowerCase() + " loaded";
  }
  bar.appendChild(count);

  const on = source.layerOn();
  const layer = elem("button", "mg-btn" + (on ? " primary" : ""));
  layer.type = "button";
  layer.dataset.layer = "1";
  layer.textContent = on ? "on" : "off";
  layer.title = "Show the " + source.label.toLowerCase() + " layer on the map";
  layer.setAttribute("aria-pressed", on ? "true" : "false");
  fkey(layer, [source.id, "layer"]);
  bar.appendChild(layer);

  return bar;
}

function presetRow(source) {
  const presets = presetsOf(source);
  if (!presets.length) { return null; }
  const wrap = elem("div", "presets");
  for (const preset of presets) {
    const btn = elem("button", activePreset[source.id] === preset.id ? "active" : "");
    btn.type = "button";
    btn.dataset.preset = preset.id;
    btn.textContent = preset.label;
    fkey(btn, [source.id, "preset", preset.id]);
    wrap.appendChild(btn);
  }
  return wrap;
}

function subRow(source, group, sub) {
  const on = subOn(source, group.id, sub.id);
  const row = elem("div", "type-row");

  const btn = elem("button", "type-toggle" + (on ? "" : " off"));
  btn.type = "button";
  btn.dataset.group = group.id;
  btn.dataset.sub = sub.id;
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  const label = elem("span");
  label.textContent = sub.label;
  const count = elem("span", "type-count");
  count.textContent = Number.isFinite(sub.count) ? String(sub.count) : "";
  btn.appendChild(label);
  btn.appendChild(count);
  fkey(btn, [source.id, "sub", group.id, sub.id]);
  row.appendChild(btn);

  const only = elem("button", "only-btn");
  only.type = "button";
  only.dataset.only = group.id;
  only.dataset.onlySub = sub.id;
  only.title = "Show only";
  only.textContent = "only";
  fkey(only, [source.id, "onlysub", group.id, sub.id]);
  row.appendChild(only);

  return row;
}

function groupRow(source, group) {
  const on = source.isGroupEnabled(group.id);
  const row = elem("div", "cat-row");
  const main = elem("div", "cat-main");

  const btn = elem("button", "cat-toggle" + (on ? "" : " off"));
  btn.type = "button";
  btn.dataset.group = group.id;
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  const ico = elem("span", "cat-ico");
  ico.style.setProperty("--pin", group.color || "var(--bronze-dim)");
  ico.appendChild(img(group.icon));
  const label = elem("span", "cat-label");
  label.textContent = group.label;
  const count = elem("span", "cat-count");
  count.textContent = Number.isFinite(group.count) ? String(group.count) : "";
  btn.appendChild(ico);
  btn.appendChild(label);
  btn.appendChild(count);
  fkey(btn, [source.id, "group", group.id]);
  main.appendChild(btn);

  const only = elem("button", "only-btn");
  only.type = "button";
  only.dataset.only = group.id;
  only.title = "Show only";
  only.textContent = "◎";
  fkey(only, [source.id, "only", group.id]);
  main.appendChild(only);

  const subs = subGroupsOf(source, group.id);
  const open = !!expanded[key(source.id, group.id)];
  if (subs.length) {
    const chevron = elem("button", "expand-btn");
    chevron.type = "button";
    chevron.dataset.expand = group.id;
    chevron.setAttribute("aria-expanded", open ? "true" : "false");
    chevron.textContent = open ? "▾" : "▸";
    fkey(chevron, [source.id, "expand", group.id]);
    main.appendChild(chevron);
  }
  row.appendChild(main);

  if (subs.length) {
    const list = elem("div", "type-list" + (open ? " open" : ""));
    for (const sub of subs) { list.appendChild(subRow(source, group, sub)); }
    row.appendChild(list);
  }
  return row;
}

function section(source) {
  ensureSubscribed(source);
  const sec = elem("div", "mg-fsec");
  sec.dataset.src = source.id;

  const listing = groupsOf(source);
  sec.appendChild(head(source, listing.total, listing.matched));
  const presets = presetRow(source);
  if (presets) { sec.appendChild(presets); }
  for (const group of listing.groups) { sec.appendChild(groupRow(source, group)); }
  return sec;
}

/**
 * Rebuilds every section. Only #filter-sections is cleared: the hard-coded
 * Players row and the panel head sit outside it and are not ours to touch.
 */
export function renderFilters() {
  if (!root) { root = document.getElementById("filter-sections"); }
  if (!root) { return; }

  const active = document.activeElement;
  const restore = active && root.contains(active) ? active.dataset.fkey : null;

  root.textContent = "";
  for (const source of allSources()) {
    // A source that joins other sources' rows (the private repo's own
    // join-tab source) would otherwise repeat the three layer toggles
    // its owners already render in their own sections — `aggregate: true` is
    // how it opts out.
    if (source.aggregate) { continue; }
    root.appendChild(section(source));
  }

  if (restore) {
    // Matched by scan rather than an attribute selector: the keys carry a NUL
    // separator, and the panel holds a few dozen buttons at most.
    for (const btn of root.querySelectorAll("[data-fkey]")) {
      if (btn.dataset.fkey === restore) { btn.focus(); break; }
    }
  }
}

/*
 * Renders are coalesced onto a microtask. One click can call setGroupEnabled
 * once per group and setSubGroupEnabled once per sub-group, and every one of
 * those notifies the source, which calls back here — so this is one rebuild per
 * turn instead of one per write.
 */
function scheduleRender() {
  if (scheduled) { return; }
  scheduled = true;
  Promise.resolve().then(function () {
    scheduled = false;
    renderFilters();
  });
}

/*
 * Sources can register after wireFilters() has run: each boots on its own
 * promise chain (contract behaviour 9) so their order is not fixed. Hooking
 * onChange the first time a source is rendered lets a late arrival wire itself
 * without a registration event to listen for.
 */
function ensureSubscribed(source) {
  if (subscribed[source.id]) { return; }
  subscribed[source.id] = true;
  source.onChange(scheduleRender);
}

// ---- actions -----------------------------------------------------------------
function clearPreset(source) {
  activePreset[source.id] = null;
}

function toggleGroup(source, groupId) {
  const on = !source.isGroupEnabled(groupId);
  source.setGroupEnabled(groupId, on);
  // A group brings its sub-groups with it. Otherwise re-enabling a category you
  // had previously drilled into shows nothing and looks broken.
  for (const sub of subGroupsOf(source, groupId)) {
    setSubOn(source, groupId, sub.id, on);
  }
  clearPreset(source);
  scheduleRender();
}

function toggleSub(source, groupId, subId) {
  const on = !subOn(source, groupId, subId);
  setSubOn(source, groupId, subId, on);
  // The two levels must agree about what is visible: turning a type on turns
  // its group on, and turning the last type off turns the group off.
  if (on) {
    source.setGroupEnabled(groupId, true);
  } else {
    let any = false;
    for (const sub of subGroupsOf(source, groupId)) {
      if (subOn(source, groupId, sub.id)) { any = true; break; }
    }
    if (!any) { source.setGroupEnabled(groupId, false); }
  }
  clearPreset(source);
  scheduleRender();
}

function applyOnly(source, groupId, subId) {
  for (const group of groupsOf(source).groups) {
    const on = group.id === groupId;
    source.setGroupEnabled(group.id, on);
    for (const sub of subGroupsOf(source, group.id)) {
      setSubOn(source, group.id, sub.id, subId ? (on && sub.id === subId) : true);
    }
  }
  // Show-only on a sub-group leaves that tree open, so the narrowed state is
  // visible instead of hidden behind a collapsed chevron.
  if (subId) { expanded[key(source.id, groupId)] = true; }
  clearPreset(source);
  scheduleRender();
}

/**
 * Drive map layer visibility from a source's group-filter picker (the private
 * build's toolbar dropdown).
 * Empty `groupId` restores every group (and turns the layer on); a concrete
 * id is the same as the filter panel's Show only for that group.
 */
export function applyMapGroupFilter(source, groupId) {
  if (!source) { return; }
  // A narrowed dropdown that left the layer off would look like a no-op.
  source.setLayerOn(true);
  if (!groupId) {
    for (const group of groupsOf(source).groups) {
      source.setGroupEnabled(group.id, true);
      for (const sub of subGroupsOf(source, group.id)) {
        setSubOn(source, group.id, sub.id, true);
      }
    }
    clearPreset(source);
    scheduleRender();
    return;
  }
  applyOnly(source, groupId, null);
}

function applyPreset(source, presetId) {
  let preset = null;
  for (const candidate of presetsOf(source)) {
    if (candidate.id === presetId) { preset = candidate; break; }
  }
  if (!preset) { return; }
  const wanted = Object.create(null);
  for (const id of preset.groupIds || []) { wanted[id] = true; }
  for (const group of groupsOf(source).groups) {
    const on = !!wanted[group.id];
    source.setGroupEnabled(group.id, on);
    // A preset means "show me these", so it un-narrows any drill-down inside
    // them too; otherwise it would silently inherit an older type filter.
    for (const sub of subGroupsOf(source, group.id)) {
      setSubOn(source, group.id, sub.id, true);
    }
  }
  activePreset[source.id] = presetId;
  scheduleRender();
}

/**
 * Switches every source's layer and every group/sub-group back on. Exported
 * so view/search.js can offer the same reset as the one-way escape from "the
 * filter panel hid everything and the map has no other way to say so".
 */
export function showAll() {
  for (const source of allSources()) {
    // The layer comes back on too: "Show all" that leaves a layer switched off
    // does nothing visible, which reads as broken.
    source.setLayerOn(true);
    for (const group of groupsOf(source).groups) {
      source.setGroupEnabled(group.id, true);
      for (const sub of subGroupsOf(source, group.id)) {
        setSubOn(source, group.id, sub.id, true);
      }
    }
    clearPreset(source);
  }
  scheduleRender();
}

function hideAll() {
  for (const source of allSources()) {
    // Groups only — not the layers, not the sub-groups. This is "hide
    // everything for now", and it should not also throw away the drill-down the
    // user set up before pressing it.
    for (const group of groupsOf(source).groups) {
      source.setGroupEnabled(group.id, false);
    }
    clearPreset(source);
  }
  scheduleRender();
}

// ---- wiring ------------------------------------------------------------------
let wired = false;

/**
 * Builds the sections and attaches the listeners. Safe to call again.
 *
 * Named `mount` so it slots into the same lifecycle step every other viewing
 * module uses (view/search.js, and the private build's panel/editor).
 */
export function mount() {
  if (wired) { renderFilters(); return; }
  root = document.getElementById("filter-sections");
  if (!root) { return; }
  wired = true;
  // The matched/total counts in every head depend on the query, not just on a
  // source's own rows/groups — a keystroke in #search has to reach here too.
  subscribeQuery(scheduleRender);

  const toggle = document.getElementById("filter-toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      const panel = document.getElementById("filter-panel");
      const open = !panel.classList.contains("open");
      panel.classList.toggle("open", open);
      this.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  const show = document.getElementById("show-all");
  if (show) { show.addEventListener("click", showAll); }
  const hide = document.getElementById("hide-all");
  if (hide) { hide.addEventListener("click", hideAll); }

  // One delegated listener for every section: the rows are rebuilt on each
  // render, so per-button handlers would leak one per group per change.
  root.addEventListener("click", function (e) {
    const sec = e.target.closest(".mg-fsec");
    if (!sec) { return; }
    const source = sourceById(sec.dataset.src);
    if (!source) { return; }

    const layer = e.target.closest("[data-layer]");
    if (layer) {
      source.setLayerOn(!source.layerOn());
      scheduleRender();
      return;
    }
    const preset = e.target.closest("[data-preset]");
    if (preset) {
      applyPreset(source, preset.getAttribute("data-preset"));
      return;
    }
    const expand = e.target.closest("[data-expand]");
    if (expand) {
      const k = key(source.id, expand.getAttribute("data-expand"));
      expanded[k] = !expanded[k];
      scheduleRender();
      return;
    }
    // Tested before the toggles: a sub-group's Show only carries both data-only
    // and data-only-sub, and it is not itself a .type-toggle.
    const only = e.target.closest("[data-only]");
    if (only) {
      applyOnly(source, only.getAttribute("data-only"), only.getAttribute("data-only-sub"));
      return;
    }
    const sub = e.target.closest(".type-toggle");
    if (sub) {
      toggleSub(source, sub.getAttribute("data-group"), sub.getAttribute("data-sub"));
      return;
    }
    const group = e.target.closest(".cat-toggle");
    if (group) {
      toggleGroup(source, group.getAttribute("data-group"));
    }
  });

  renderFilters();
}
