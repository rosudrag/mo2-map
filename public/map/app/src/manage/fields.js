/*
 * Field-type renderers for the generic editor.
 *
 * The editor knows nothing about field types. It asks this module for a
 * renderer per entry in `source.fields`, mounts it, and later reads every
 * renderer back. Adding a type means adding an entry to RENDERERS here and
 * nothing else — that is the whole point of the split, and it is why
 * editor.js contains no `switch` on `field.type`.
 *
 * Every renderer is a factory returning one uniform instance:
 *
 *   { mount(container, field, value, onChange), read() }
 *
 *   mount()  builds the control inside `container` and calls `onChange()`
 *            after any user edit, so the editor can recompute its dirty state.
 *   read()   returns the current value, or `undefined` to mean "I contribute
 *            nothing to the save payload". That is how display-only types
 *            (readonly, coords) stay out of the write without the editor
 *            having to know which types those are.
 *
 * `field.readonly` is set by the editor for a source whose `can.edit` is false.
 * Every renderer must honour it. That is the discoveries case: a machine-
 * observed row has nothing to author, so the same code renders a details view
 * instead of a form and no second read-only UI has to exist.
 */
import { openMenu } from "../ui/picker.js";
import { worldToMap, mapToWorld } from "../map/projection.js";

// ---- shared scaffolding ------------------------------------------------------
function elem(tag, cls) {
  const node = document.createElement(tag);
  if (cls) { node.className = cls; }
  return node;
}

/**
 * The label + control shell every field shares, so the form is uniform across
 * sources and a new type cannot quietly grow its own layout.
 *
 * @returns {HTMLElement} the wrapper; the renderer appends its control to it
 */
function frame(container, field) {
  const wrap = elem("div", "mg-field" + (field.readonly ? " readonly" : ""));
  wrap.dataset.field = field.key;
  const label = elem("label", "mg-field-label");
  label.textContent = field.label || field.key;
  label.htmlFor = "mg-f-" + field.key;
  wrap.appendChild(label);
  container.appendChild(wrap);
  return wrap;
}

/** A small muted line under a control: hints and empty states. */
function hint(wrap, text) {
  const span = elem("span", "mg-hint");
  span.textContent = text;
  wrap.appendChild(span);
  return span;
}

function textish(value) {
  return value === null || value === undefined ? "" : String(value);
}

function applyLimit(input, field) {
  if (Number.isFinite(field.maxLength)) { input.maxLength = field.maxLength; }
  if (field.placeholder) { input.placeholder = field.placeholder; }
}

/** `options` may be a function or an array, of plain strings or full objects. */
function optionList(field) {
  const raw = typeof field.options === "function" ? field.options() : field.options;
  const out = [];
  for (const opt of raw || []) {
    if (opt === null || opt === undefined) { continue; }
    if (typeof opt === "object") {
      out.push({
        value: String(opt.value),
        label: String(opt.label === undefined ? opt.value : opt.label),
        color: opt.color || "",
        icon: opt.icon || ""
      });
    } else {
      out.push({ value: String(opt), label: String(opt), color: "", icon: "" });
    }
  }
  return out;
}

// ---- text --------------------------------------------------------------------
function makeText() {
  let input = null;
  return {
    mount: function (container, field, value, onChange) {
      const wrap = frame(container, field);
      input = elem("input");
      input.type = "text";
      input.id = "mg-f-" + field.key;
      input.autocomplete = "off";
      input.value = textish(value);
      applyLimit(input, field);
      input.readOnly = !!field.readonly;
      input.addEventListener("input", onChange);
      wrap.appendChild(input);
    },
    read: function () { return input.value.trim(); }
  };
}

// ---- slug --------------------------------------------------------------------
/*
 * An <input list=…>, not a <select>. A datalist degrades to a plain text field
 * when the popup is unavailable — the embedded-browser-view case the POI editor
 * also works around — and these values are free-form strings on the wire anyway,
 * so a closed dropdown would be a lie about the data model.
 */
function makeSlug() {
  let input = null;
  return {
    mount: function (container, field, value, onChange) {
      const wrap = frame(container, field);
      input = elem("input");
      input.type = "text";
      input.id = "mg-f-" + field.key;
      input.autocomplete = "off";
      input.value = textish(value);
      applyLimit(input, field);
      input.readOnly = !!field.readonly;
      input.addEventListener("input", onChange);
      wrap.appendChild(input);

      const list = elem("datalist");
      list.id = "mg-dl-" + field.key;
      for (const opt of optionList(field)) {
        const node = elem("option");
        node.value = opt.value;
        if (opt.label !== opt.value) { node.label = opt.label; }
        list.appendChild(node);
      }
      input.setAttribute("list", list.id);
      wrap.appendChild(list);
    },
    read: function () { return input.value.trim(); }
  };
}

// ---- pick --------------------------------------------------------------------
/*
 * A button opening ui/picker.js's popover. Same reasoning as the
 * datalist above — native <select> popups fail in the game client — plus the
 * menu can show each option's colour, which neither a prompt nor a bare text
 * field can. One menu implementation on the page, not two.
 */
function makePick() {
  let current = "";
  let btn = null;
  let dot = null;
  let val = null;

  function paint(field) {
    let match = null;
    for (const opt of optionList(field)) {
      if (opt.value === current) { match = opt; break; }
    }
    dot.style.setProperty("--pin", (match && match.color) || "var(--bronze-dim)");
    // An unrecognised value still shows its raw slug: the row holds it, so
    // hiding it would make the editor disagree with the list beside it.
    val.textContent = match ? match.label : (current || field.placeholder || "Choose…");
    val.classList.toggle("placeholder", !current);
  }

  return {
    mount: function (container, field, value, onChange) {
      const wrap = frame(container, field);
      current = textish(value);
      btn = elem("button", "mg-pickbtn");
      btn.type = "button";
      btn.id = "mg-f-" + field.key;
      btn.disabled = !!field.readonly;
      dot = elem("span", "mg-dot");
      val = elem("span", "val");
      const caret = elem("span", "caret");
      caret.textContent = "▾";
      btn.appendChild(dot);
      btn.appendChild(val);
      btn.appendChild(caret);
      paint(field);
      btn.addEventListener("click", function () {
        const items = optionList(field);
        for (const item of items) { item.active = item.value === current; }
        openMenu(btn, {
          title: field.label || field.key,
          items: items,
          empty: "Nothing to choose.",
          onPick: function (picked) {
            current = picked;
            paint(field);
            onChange();
          }
        });
      });
      wrap.appendChild(btn);
    },
    read: function () { return current; }
  };
}

// ---- enum --------------------------------------------------------------------
/*
 * Segmented buttons, ported from the bookmark editor's tier group: a handful of
 * fixed choices reads better as one visible row than as a dropdown you have to
 * open before you learn what it offers.
 */
function makeEnum() {
  let current = "";
  let group = null;

  function paint() {
    for (const btn of group.querySelectorAll("button[data-value]")) {
      const on = btn.dataset.value === current;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  return {
    mount: function (container, field, value, onChange) {
      const wrap = frame(container, field);
      const options = optionList(field);
      current = textish(value);
      // A value outside the option set would leave every segment unlit, which
      // reads as "unanswered" rather than "a value this build does not know".
      let known = false;
      for (const opt of options) { if (opt.value === current) { known = true; break; } }
      if (!known && options.length) { current = options[0].value; }

      group = elem("div", "mg-enum");
      group.id = "mg-f-" + field.key;
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", field.label || field.key);
      for (const opt of options) {
        const seg = elem("button");
        seg.type = "button";
        seg.dataset.value = opt.value;
        seg.textContent = opt.label;
        seg.disabled = !!field.readonly;
        group.appendChild(seg);
      }
      paint();
      if (!field.readonly) {
        group.addEventListener("click", function (e) {
          const seg = e.target.closest("button[data-value]");
          if (!seg) { return; }
          current = seg.dataset.value;
          paint();
          onChange();
        });
      }
      wrap.appendChild(group);
    },
    read: function () { return current; }
  };
}

// ---- tags --------------------------------------------------------------------
function makeTags() {
  let tags = [];
  let box = null;
  let input = null;

  function render() {
    for (const chip of box.querySelectorAll(".mg-tag")) { box.removeChild(chip); }
    tags.forEach(function (tag, i) {
      const chip = elem("span", "mg-tag");
      chip.appendChild(document.createTextNode(tag));
      if (input) {
        const x = elem("button");
        x.type = "button";
        x.dataset.tagRemove = String(i);
        x.setAttribute("aria-label", "Remove tag " + tag);
        x.textContent = "×";
        chip.appendChild(x);
      }
      box.insertBefore(chip, input);
    });
  }

  function add(value) {
    const tag = String(value || "").trim();
    if (!tag) { return false; }
    for (const t of tags) {
      if (t.toLowerCase() === tag.toLowerCase()) { return false; }
    }
    tags.push(tag);
    render();
    return true;
  }

  return {
    mount: function (container, field, value, onChange) {
      const wrap = frame(container, field);
      tags = Array.isArray(value) ? value.slice() : [];
      box = elem("div", "mg-tagbox");
      wrap.appendChild(box);

      if (field.readonly) {
        input = null;              // render() keys off this to omit the × buttons
        render();
        if (!tags.length) { hint(wrap, "No tags."); }
        return;
      }

      input = elem("input", "mg-tag-input");
      input.type = "text";
      input.id = "mg-f-" + field.key;
      input.autocomplete = "off";
      input.placeholder = field.placeholder || "add tag…";
      box.appendChild(input);
      render();

      // One delegated listener: the chips are rebuilt on every change, so
      // per-chip handlers would leak one per tag per edit.
      box.addEventListener("click", function (e) {
        const rm = e.target.closest("[data-tag-remove]");
        if (!rm) { return; }
        tags.splice(Number(rm.getAttribute("data-tag-remove")), 1);
        render();
        onChange();
      });

      input.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !this.value && tags.length) {
          // Backspace on an empty tag field removes the last chip, as every tag
          // input on the web does.
          e.preventDefault();
          tags.pop();
          render();
          onChange();
          return;
        }
        if (e.key !== "Enter" && e.key !== ",") { return; }
        // stopPropagation so the editor's "Enter saves" shortcut does not fire
        // while the user is still building the list.
        e.preventDefault();
        e.stopPropagation();
        add(this.value);
        this.value = "";
        onChange();
      });

      // Typing in the tag box is itself an unsaved change, because read() below
      // counts the uncommitted text. Without this the dirty flag would only
      // catch tags that were committed with Enter.
      input.addEventListener("input", onChange);
    },
    read: function () {
      // A tag typed but never committed is still a tag the user meant, so it
      // counts — but read() runs on every keystroke for the dirty check, so it
      // must not touch the DOM. Returning the pending text without committing
      // it keeps both callers honest: the dirty flag sees the change, Save
      // sends it, and the input the user is still typing in is left alone.
      const out = tags.slice();
      const pending = input ? input.value.trim() : "";
      if (!pending) { return out; }
      for (const t of out) {
        if (t.toLowerCase() === pending.toLowerCase()) { return out; }
      }
      out.push(pending);
      return out;
    }
  };
}

// ---- note --------------------------------------------------------------------
function makeNote() {
  let area = null;
  return {
    mount: function (container, field, value, onChange) {
      const wrap = frame(container, field);
      area = elem("textarea");
      area.id = "mg-f-" + field.key;
      area.rows = field.rows || 4;
      area.value = textish(value);
      applyLimit(area, field);
      area.readOnly = !!field.readonly;
      area.addEventListener("input", onChange);
      wrap.appendChild(area);
    },
    // Not trimmed: a note's indentation and trailing blank line are content.
    read: function () { return area.value; }
  };
}

// ---- meta --------------------------------------------------------------------
function makeMeta() {
  let rows = null;
  let readonly = false;

  function addRow(key, value, onChange) {
    const row = elem("div", "mg-meta-row");
    const k = elem("input", "mg-meta-key");
    k.type = "text";
    k.placeholder = "key";
    k.value = key || "";
    k.readOnly = readonly;
    const v = elem("input", "mg-meta-val");
    v.type = "text";
    v.placeholder = "value";
    v.value = value === null || value === undefined ? "" : String(value);
    v.readOnly = readonly;
    row.appendChild(k);
    row.appendChild(v);
    if (!readonly) {
      const del = elem("button", "mg-btn danger");
      del.type = "button";
      del.setAttribute("aria-label", "Remove field");
      del.textContent = "×";
      del.addEventListener("click", function () {
        rows.removeChild(row);
        onChange();
      });
      row.appendChild(del);
    }
    rows.appendChild(row);
    return k;
  }

  return {
    mount: function (container, field, value, onChange) {
      const wrap = frame(container, field);
      readonly = !!field.readonly;
      rows = elem("div", "mg-meta-rows");
      rows.id = "mg-f-" + field.key;
      wrap.appendChild(rows);

      const seed = value && typeof value === "object" ? value : null;
      if (seed) {
        for (const k of Object.keys(seed)) { addRow(k, seed[k], onChange); }
      }
      if (readonly) {
        if (!rows.childNodes.length) { hint(wrap, "No extra fields."); }
        return;
      }

      const add = elem("button", "mg-btn");
      add.type = "button";
      add.textContent = "+ Field";
      add.addEventListener("click", function () {
        addRow("", "", onChange).focus();
        onChange();
      });
      wrap.appendChild(add);

      rows.addEventListener("input", onChange);
    },
    read: function () {
      const meta = {};
      let n = 0;
      for (const row of rows.querySelectorAll(".mg-meta-row")) {
        const k = row.querySelector(".mg-meta-key").value.trim();
        // A row with no key is one the user started and abandoned. Dropping it
        // is kinder than failing the save over it.
        if (!k) { continue; }
        meta[k] = row.querySelector(".mg-meta-val").value;
        n++;
      }
      return n ? meta : null;
    }
  };
}

// ---- readonly ----------------------------------------------------------------
/*
 * Static text. `field.value(row)` is resolved by the editor before mount, so
 * this renderer never needs the row and stays as dumb as every other one.
 */
function makeReadonly() {
  return {
    mount: function (container, field, value) {
      const wrap = frame(container, field);
      const span = elem("span", "mg-readonly");
      span.id = "mg-f-" + field.key;
      const text = textish(value);
      span.textContent = text === "" ? "—" : text;
      wrap.appendChild(span);
    },
    read: function () { return undefined; }
  };
}

// ---- coords ------------------------------------------------------------------
/*
 * Both frames, always, whichever one the source stores.
 *
 * Bookmarks and discoveries carry UE world metres; the pin catalogue carries
 * canvas pixels. Showing only the stored frame would make one field mean two
 * different things across tabs, and the conversion is a single call either way.
 * map/projection.js is the only projection path (contract behaviour 10, and
 * docs/map-coordinates.md) — no constant is ever copied out of it.
 */
function fmt(n, digits) {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

/** World metres, converting from canvas if that is what the source stores. */
function worldOf(value) {
  if (!value) { return null; }
  if (Number.isFinite(value.x) && Number.isFinite(value.y)) {
    return { x: value.x, y: value.y };
  }
  return mapToWorld(value.lat, value.lng);
}

/** Canvas pixels, converting from world if that is what the source stores. */
function canvasOf(value, world) {
  if (value && Number.isFinite(value.lat) && Number.isFinite(value.lng)) {
    return { lat: value.lat, lng: value.lng };
  }
  return world ? worldToMap(world.x, world.y) : null;
}

function readoutRow(grid, key, text) {
  const row = elem("div");
  const k = elem("span", "mg-coord-key");
  k.textContent = key;
  const v = elem("span", "mg-coord-val");
  v.textContent = text;
  row.appendChild(k);
  row.appendChild(v);
  grid.appendChild(row);
}

function makeCoords() {
  return {
    mount: function (container, field, value) {
      const wrap = frame(container, field);
      const world = worldOf(value);
      const canvas = canvasOf(value, world);

      const grid = elem("div", "mg-coord-read");
      grid.id = "mg-f-" + field.key;

      let worldText = "—";
      if (world) {
        worldText = "X " + fmt(world.x, 0) + " · Y " + fmt(world.y, 0);
        if (value && Number.isFinite(value.z)) { worldText += " · Z " + fmt(value.z, 0); }
      }
      readoutRow(grid, "World", worldText);
      readoutRow(grid, "Canvas", canvas
        ? "lat " + fmt(canvas.lat, 1) + " · lng " + fmt(canvas.lng, 1)
        : "—");
      wrap.appendChild(grid);

      // Moving a marker is a map gesture — drag, or right-click add — not a form
      // field: typing a position you cannot see is how a pin gets lost. So this
      // readout never writes, on any source.
      hint(wrap, field.hint || "Drag the marker on the map to move it.");
    },
    read: function () { return undefined; }
  };
}

// ---- registry ----------------------------------------------------------------
const RENDERERS = {
  text: makeText,
  slug: makeSlug,
  pick: makePick,
  enum: makeEnum,
  tags: makeTags,
  note: makeNote,
  meta: makeMeta,
  readonly: makeReadonly,
  coords: makeCoords
};

/**
 * A fresh renderer instance for a field type.
 *
 * An unknown type falls back to the readonly renderer instead of throwing: a
 * source declaring a type this build does not carry should cost that one field
 * its editability, not take the whole editor down with it.
 *
 * @param {string} type
 * @returns {{mount: Function, read: Function}}
 */
export function createRenderer(type) {
  const make = RENDERERS[type] || RENDERERS.readonly;
  return make();
}
