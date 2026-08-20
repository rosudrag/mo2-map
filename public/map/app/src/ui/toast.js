/*
 * Transient notices, with an optional action button.
 *
 * The action slot is what makes destructive operations undoable instead of
 * confirm-gated: "Deleted Troll camp — Undo" is strictly better than a modal
 * asking permission for something the user just asked for. A confirm dialog
 * costs a click on every delete and still cannot recover a mistake; an undo
 * costs nothing on the happy path and recovers the one case that matters.
 */
const HOLD_MS = { ok: 5000, warn: 9000 };

// How long a destructive action stays undoable in the toast. A floor on the
// hold time of any action toast, not just bookmarks' — whichever source
// offers an undo gets the same guarantee.
const UNDO_MS = 9000;

let host = null;

function hostEl() {
  if (!host) { host = document.getElementById("bm-toasts"); }
  return host;
}

/**
 * @param {string} message
 * @param {"ok"|"warn"} [kind]
 * @param {{label: string, run: () => void, ms?: number}} [action]
 */
export function toast(message, kind, action) {
  const parent = hostEl();
  if (!parent) { return null; }
  const el = document.createElement("div");
  el.className = "bm-toast " + (kind === "warn" ? "warn" : "ok");
  el.setAttribute("role", kind === "warn" ? "alert" : "status");

  const span = document.createElement("span");
  span.textContent = message;
  el.appendChild(span);

  let timer = null;
  function dismiss() {
    if (timer !== null) { window.clearTimeout(timer); timer = null; }
    if (el.parentNode) { parent.removeChild(el); }
  }

  if (action && action.label && action.run) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.addEventListener("click", function () {
      dismiss();
      action.run();
    });
    el.appendChild(btn);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "bm-toast-x";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "✕";
  close.addEventListener("click", dismiss);
  el.appendChild(close);

  parent.appendChild(el);
  const hold = (action && action.ms) || HOLD_MS[kind === "warn" ? "warn" : "ok"];
  timer = window.setTimeout(dismiss, action ? Math.max(hold, UNDO_MS) : hold);
  return { el: el, dismiss: dismiss };
}

export function fail(prefix, err) {
  toast(prefix + ": " + ((err && err.message) || "network error"), "warn");
}
