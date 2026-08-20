/*
 * The generic editor aside.
 *
 * One editor for every source. It has no idea what a bookmark, a pin or a
 * discovery is: it walks `source.fields`, asks fields.js for a renderer per
 * entry, seeds them from `source.toForm(row)`, and hands whatever they read
 * back to `source.save(id, values)`. There is no `switch` on field type here
 * and no branch on `source.id` anywhere — a new field type is a renderer in
 * fields.js, and a new source is a descriptor.
 *
 * Capabilities decide the shape, not identity:
 *   can.edit   false -> every field mounts read-only and Save does not exist.
 *                       This is the discoveries case. A machine-observed row
 *                       has nothing to author — editing its position or class
 *                       would be overwritten by the next publish, or would
 *                       simply be a lie — so the same code becomes a details
 *                       view instead of a form. save() also refuses outright,
 *                       so a stray keyboard shortcut cannot write either.
 *   can.remove false -> no Delete.
 *
 * Ported wholesale from the (never-wired) bookmarks/editor.js: the dirty
 * guard, Ctrl+S / Ctrl+Enter from anywhere in the form, focus to the first
 * field on open and back to the opener on close, and the modal keydown swallow
 * that stops the panel's Del shortcut deleting the row being edited.
 */
import { createRenderer } from "./fields.js";
import { askConfirm } from "../ui/confirm.js";

const el = {};
let cached = false;

let current = null;      // { source, id, name }
let renderers = [];      // [{ field, renderer }]
let baseline = null;     // serialised form as opened, for the dirty check
let returnFocusTo = null;
let saving = false;

function cache() {
  if (cached) { return; }
  cached = true;
  el.panel = document.getElementById("manage-editor");
  el.backdrop = document.getElementById("manage-backdrop");
  el.title = document.getElementById("mg-editor-title");
  el.fields = document.getElementById("mg-fields");
  el.del = document.getElementById("mg-editor-delete");
  el.cancel = document.getElementById("mg-editor-cancel");
  el.save = document.getElementById("mg-editor-save");
  el.close = document.getElementById("mg-editor-close");
  el.status = document.getElementById("mg-editor-status");
}

// ---- capabilities ------------------------------------------------------------
/*
 * Read positively: a source that forgot to declare a capability gets the safe
 * answer, not the permissive one. Nothing here looks at source.id.
 */
function canEdit(source) {
  return !!(source.can && source.can.edit === true);
}

function canRemove(source) {
  return !!(source.can && source.can.remove === true);
}

// ---- form <-> source ---------------------------------------------------------
function findRow(source, id) {
  for (const row of source.rows()) {
    if (source.rowId(row) === id) { return row; }
  }
  return null;
}

/** Everything the form can express. Display-only renderers read `undefined`. */
function readValues() {
  const values = {};
  for (const entry of renderers) {
    const value = entry.renderer.read();
    if (value !== undefined) { values[entry.field.key] = value; }
  }
  return values;
}

function serialise() {
  return JSON.stringify(readValues());
}

function isDirty() {
  return baseline !== null && serialise() !== baseline;
}

function syncDirty() {
  if (!el.panel) { return; }
  el.panel.classList.toggle("dirty", isDirty());
}

function status(text, kind) {
  if (!el.status) { return; }
  el.status.textContent = text || "";
  el.status.classList.toggle("err", kind === "err");
  el.status.classList.toggle("ok", kind === "ok");
}

function build(source, row) {
  const editable = canEdit(source);
  const values = source.toForm(row) || {};
  el.fields.textContent = "";
  renderers = [];

  for (const field of source.fields || []) {
    // A field is read-only when the source cannot be edited at all, or when the
    // field says so itself. Both collapse to one flag the renderer honours, so
    // no renderer needs to know which case it is in.
    const readonly = !editable || field.readonly === true;
    const spec = readonly === !!field.readonly
      ? field
      : Object.assign({}, field, { readonly: readonly });
    // `value(row)` lets a field compute itself from the row rather than needing
    // a slot in toForm(). Generic: any type may use it, not just `readonly`.
    const value = typeof field.value === "function" ? field.value(row) : values[field.key];
    const renderer = createRenderer(field.type);
    renderer.mount(el.fields, spec, value, syncDirty);
    renderers.push({ field: field, renderer: renderer });
  }
}

// ---- open / close ------------------------------------------------------------
/**
 * @param {Object} source a ManageSource
 * @param {string} id     row id on that source
 */
export function openEditor(source, id) {
  cache();
  if (!source || !el.panel) { return; }

  if (current && current.source === source && current.id === id) {
    // Re-opening the row already on screen. With unsaved work that must be a
    // no-op: re-seeding the form would wipe the edit for a gesture that asked
    // for nothing. Clean, it is a harmless refresh from the current row.
    if (isDirty()) { return; }
  } else if (current && isDirty()) {
    // Switching rows asks first rather than silently throwing the edit away —
    // the same promise the close path makes.
    askDiscard(function () {
      // The answer WAS the discard, so drop the baseline before re-entering:
      // otherwise the guard above sees the same unsaved form and asks again.
      baseline = null;
      openEditor(source, id);
    });
    return;
  }

  const row = findRow(source, id);
  if (!row) { return; }

  returnFocusTo = document.activeElement;
  saving = false;
  const editable = canEdit(source);
  const name = source.title(row) || source.label;
  current = { source: source, id: id, name: name };

  el.title.textContent = editable ? "Edit " + name : name;
  el.panel.classList.toggle("readonly", !editable);
  status("", "");
  build(source, row);

  // Absent, not merely disabled: a Save the user can see but never use is a
  // question the UI keeps asking and answering with nothing.
  el.save.style.display = editable ? "" : "none";
  el.del.style.display = canRemove(source) ? "" : "none";
  el.cancel.textContent = editable ? "Cancel" : "Close";

  baseline = serialise();
  syncDirty();

  el.panel.classList.add("open");
  el.panel.setAttribute("aria-hidden", "false");
  el.backdrop.classList.add("open");

  const first = editable
    ? el.fields.querySelector("input:not([readonly]), textarea:not([readonly]), button:not([disabled])")
    : null;
  if (first) {
    first.focus();
    if (first.select) { first.select(); }
  } else {
    el.close.focus();
  }
}

function reallyClose() {
  current = null;
  renderers = [];
  baseline = null;
  saving = false;
  el.panel.classList.remove("open", "dirty", "readonly");
  el.panel.setAttribute("aria-hidden", "true");
  el.backdrop.classList.remove("open");
  el.fields.textContent = "";
  status("", "");
  if (returnFocusTo && returnFocusTo.focus) { returnFocusTo.focus(); }
  returnFocusTo = null;
}

/*
 * Not window.confirm: a native dialog is unstyleable and, in an embedded
 * browser view, the same class of control the POI editor already hand-rolls around.
 * ui/confirm.js owns #mg-confirm so the editor and the bulk bar ask their
 * questions in the same place, in the same words.
 */
function askDiscard(onDiscard) {
  askConfirm({
    title: "Discard changes?",
    text: "This edit has not been saved.",
    confirmLabel: "Discard",
    danger: true
  }).then(function (yes) {
    if (yes) { onDiscard(); }
  });
}

export function closeEditor() {
  cache();
  if (!current) { return; }
  if (isDirty()) { askDiscard(reallyClose); return; }
  reallyClose();
}

export function editorOpen() {
  return current !== null;
}

// ---- save --------------------------------------------------------------------
function save() {
  if (!current || saving) { return; }
  const source = current.source;
  // The real defence, not just the hidden button: nothing reachable — shortcut,
  // console, a caller that guessed wrong — can write to a source that says no.
  if (!canEdit(source)) { return; }

  const values = readValues();
  for (const entry of renderers) {
    const field = entry.field;
    if (field.required !== true) { continue; }
    const value = values[field.key];
    const empty = value === undefined || value === null || value === "" ||
      (Array.isArray(value) && !value.length);
    if (!empty) { continue; }
    status((field.label || field.key) + " is required.", "err");
    const node = document.getElementById("mg-f-" + field.key);
    if (node && node.focus) { node.focus(); }
    return;
  }

  saving = true;
  status("Saving…", "");
  const id = current.id;
  Promise.resolve(source.save(id, values)).then(function () {
    // Guard against a close or a row switch that happened while the write was
    // in flight: the panel below is still live and the user may have moved on.
    if (!current || current.id !== id) { return; }
    baseline = serialise();
    reallyClose();
  }).catch(function (err) {
    saving = false;
    if (!current || current.id !== id) { return; }
    status((err && err.message) || "Save failed.", "err");
  });
}

// ---- delete ------------------------------------------------------------------
function requestDelete() {
  if (!current) { return; }
  const source = current.source;
  if (!canRemove(source)) { return; }
  const id = current.id;
  const name = current.name;

  // Deleting is not "unsaved changes"; dropping the baseline first stops the
  // close path asking about edits it is about to discard anyway.
  function go() {
    baseline = null;
    reallyClose();
    Promise.resolve(source.remove([id])).catch(function () {
      // The source owns its own failure reporting — toast, and a rollback of
      // the optimistic write. There is nothing useful to say from here; the
      // editor is already gone.
    });
  }

  // A source that can undo its own delete says so by returning nothing: an
  // undo costs nothing on the happy path and recovers the one case that
  // matters, where a confirm costs a click every time and recovers nothing.
  const warning = typeof source.removeWarning === "function"
    ? source.removeWarning([id])
    : null;
  if (!warning) { go(); return; }
  askConfirm({
    title: "Delete " + name + "?",
    text: warning,
    confirmLabel: "Delete",
    danger: true
  }).then(function (yes) {
    // The row can be gone by the time the answer arrives (a poll, or a bulk
    // delete from the panel). current is nulled on close, so re-check.
    if (yes && current && current.id === id) { go(); }
  });
}

// ---- wiring ------------------------------------------------------------------
let wired = false;

/**
 * Attaches the editor's listeners. Safe to call again; wires only once.
 *
 * Named `mount` to match `panel.mount()` and `filters.mount()` — main.js mounts
 * all three the same way, and three different verbs for one lifecycle step is
 * how the first integration build broke (it called `.mount()` on a module that
 * exported `wireEditor`, which minifies to `(void 0)()` and throws at runtime
 * AFTER the panel had already mounted, so the page looked half-alive).
 */
export function mount() {
  cache();
  if (wired || !el.panel) { return; }
  wired = true;

  el.close.addEventListener("click", closeEditor);
  el.cancel.addEventListener("click", closeEditor);
  el.save.addEventListener("click", save);
  el.del.addEventListener("click", requestDelete);

  // The backdrop is shared with the panel; while the editor is up it belongs to
  // the editor, and panel.js defers to that by checking for .open on us.
  el.backdrop.addEventListener("click", function () {
    if (current) { closeEditor(); }
  });

  el.panel.addEventListener("keydown", function (e) {
    // The editor is modal: it swallows keys so the panel-wide layer cannot also
    // act on them (Del would otherwise delete the row being edited).
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "Enter")) {
      e.preventDefault();
      save();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeEditor();
      return;
    }
    // Enter in a single-line field saves. The note textarea keeps its newlines,
    // the tag input swallows Enter itself, and a meta row's key/value pair is
    // usually mid-entry when Enter is pressed.
    if (e.key === "Enter" && e.target.tagName === "INPUT" &&
        !e.target.classList.contains("mg-tag-input") &&
        !e.target.closest(".mg-meta-row")) {
      e.preventDefault();
      save();
    }
  });
}
