/*
 * In-panel popovers: a choice menu and a text prompt.
 *
 * TWO reasons this exists instead of window.prompt / <select>.
 *
 * 1. Correctness in an embedded browser view. The POI editor it replaced
 *    carried the comment "native <select> popups fail in an embedded browser
 *    view" and hand-rolled its own pickers for that reason; .mg-pickbtn in
 *    styles/controls.css is that control, and this is the menu it opens. The
 *    bookmark panel, meanwhile, was shipped with native <select> elements and
 *    window.prompt for every bulk edit, so in that embedded view those were
 *    its least reliable part.
 * 2. A prompt cannot show you what your options are. "Set category" asking for a
 *    free-text slug invites typos that silently create a new category; a menu of
 *    the real taxonomy with its colours cannot.
 *
 * Both popovers are keyboard-first: Up/Down/Enter/Escape, focus is moved into the
 * popover and restored to the trigger on close.
 */
import { escapeHtml } from "../util/html.js";

let open = null;

function closeOpen(restoreFocus) {
  if (!open) { return; }
  const { el, trigger, onClose } = open;
  open = null;
  if (el.parentNode) { el.parentNode.removeChild(el); }
  document.removeEventListener("mousedown", onDocMouseDown, true);
  document.removeEventListener("keydown", onDocKeyDown, true);
  if (restoreFocus && trigger && trigger.focus) { trigger.focus(); }
  if (onClose) { onClose(); }
}

export function closePicker() {
  closeOpen(false);
}

function onDocMouseDown(e) {
  if (!open) { return; }
  if (open.el.contains(e.target) || e.target === open.trigger) { return; }
  closeOpen(false);
}

function onDocKeyDown(e) {
  if (!open) { return; }
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeOpen(true);
  }
}

/**
 * Positions the popover under its trigger, flipped up or nudged left when it
 * would leave the viewport. The panel is a fixed-width column on the right, so
 * "always below-left" would clip on short windows.
 */
function place(el, trigger) {
  const r = trigger.getBoundingClientRect();
  el.style.visibility = "hidden";
  document.body.appendChild(el);
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let left = r.left;
  let top = r.bottom + 4;
  if (left + w > window.innerWidth - 8) { left = Math.max(8, window.innerWidth - w - 8); }
  if (top + h > window.innerHeight - 8) { top = Math.max(8, r.top - h - 4); }
  el.style.left = Math.round(left) + "px";
  el.style.top = Math.round(top) + "px";
  el.style.visibility = "";
}

function shell(title) {
  const el = document.createElement("div");
  el.className = "mg-pop";
  el.setAttribute("role", "dialog");
  if (title) {
    const head = document.createElement("div");
    head.className = "mg-pop-head";
    head.textContent = title;
    el.appendChild(head);
  }
  return el;
}

function wireListNav(el, itemSelector) {
  el.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") { return; }
    const items = Array.prototype.slice.call(el.querySelectorAll(itemSelector));
    if (!items.length) { return; }
    e.preventDefault();
    const at = items.indexOf(document.activeElement);
    const next = e.key === "ArrowDown"
      ? (at + 1) % items.length
      : (at <= 0 ? items.length - 1 : at - 1);
    items[next].focus();
  });
}

/**
 * A menu of choices.
 *
 * @param trigger the element the popover hangs off
 * @param {{title?: string, items: Array<{value: string, label: string,
 *   color?: string, icon?: string, active?: boolean}>, onPick: (value: string) => void,
 *   empty?: string}} opts
 */
export function openMenu(trigger, opts) {
  closeOpen(false);
  const el = shell(opts.title);

  if (!opts.items.length) {
    const none = document.createElement("div");
    none.className = "mg-pop-empty";
    none.textContent = opts.empty || "Nothing to choose.";
    el.appendChild(none);
  }

  for (const item of opts.items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mg-pop-item" + (item.active ? " active" : "");
    btn.dataset.value = item.value;
    let inner = "";
    if (item.color) {
      inner += '<span class="mg-dot" style="--pin:' + escapeHtml(item.color) + '"></span>';
    }
    inner += '<span class="mg-pop-label">' + escapeHtml(item.label) + "</span>";
    btn.innerHTML = inner;
    btn.addEventListener("click", function () {
      const value = this.dataset.value;
      closeOpen(true);
      opts.onPick(value);
    });
    el.appendChild(btn);
  }

  wireListNav(el, ".mg-pop-item");
  place(el, trigger);
  open = { el: el, trigger: trigger, onClose: opts.onClose };
  document.addEventListener("mousedown", onDocMouseDown, true);
  document.addEventListener("keydown", onDocKeyDown, true);
  const first = el.querySelector(".mg-pop-item.active") || el.querySelector(".mg-pop-item");
  if (first) { first.focus(); }
  return el;
}

/**
 * A one-field text prompt with optional click-to-fill suggestions.
 *
 * @param trigger
 * @param {{title?: string, placeholder?: string, value?: string,
 *   suggestions?: string[], submitLabel?: string, onSubmit: (value: string) => void}} opts
 */
export function openInput(trigger, opts) {
  closeOpen(false);
  const el = shell(opts.title);

  const form = document.createElement("form");
  form.className = "mg-pop-form";
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.placeholder = opts.placeholder || "";
  input.value = opts.value || "";
  form.appendChild(input);
  const go = document.createElement("button");
  go.type = "submit";
  go.className = "mg-btn primary";
  go.textContent = opts.submitLabel || "OK";
  form.appendChild(go);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) { closeOpen(true); return; }
    closeOpen(true);
    opts.onSubmit(value);
  });
  el.appendChild(form);

  const suggestions = (opts.suggestions || []).filter(Boolean);
  if (suggestions.length) {
    const wrap = document.createElement("div");
    wrap.className = "mg-pop-chips";
    for (const s of suggestions) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "mg-tag";
      chip.textContent = s;
      chip.addEventListener("click", function () {
        closeOpen(true);
        opts.onSubmit(s);
      });
      wrap.appendChild(chip);
    }
    el.appendChild(wrap);
  }

  place(el, trigger);
  open = { el: el, trigger: trigger, onClose: opts.onClose };
  document.addEventListener("mousedown", onDocMouseDown, true);
  document.addEventListener("keydown", onDocKeyDown, true);
  input.focus();
  input.select();
  return el;
}

export function pickerOpen() {
  return !!open;
}
