/*
 * The manager's one confirm dialog (#mg-confirm).
 *
 * It lives in its own file for two reasons. The row list, the bulk bar and the
 * editor all delete, and all three must ask the same question the same way;
 * and putting it in either panel.js or list.js would make those two import each
 * other, which is a cycle for a modal that belongs to neither.
 *
 * WHETHER to ask is never decided here. `source.removeWarning(ids)` returns the
 * sentence a source wants shown, or null when its delete is undoable and a
 * confirm would just be a speed bump — bookmarks tombstone and offer Undo, pins
 * issue a real DELETE. The dialog only knows how to ask.
 */
const el = {};
let settle = null;
let returnFocusTo = null;

function cache() {
  if (el.root) { return; }
  el.root = document.getElementById("mg-confirm");
  if (!el.root) { return; }
  el.title = document.getElementById("mg-confirm-title");
  el.text = document.getElementById("mg-confirm-text");
  el.no = document.getElementById("mg-confirm-no");
  el.yes = document.getElementById("mg-confirm-yes");

  el.no.addEventListener("click", function () { close(false); });
  el.yes.addEventListener("click", function () { close(true); });

  // A click on the dialog's own backdrop area — anywhere outside .box — reads as
  // "no", the same as Escape. A destructive default must never be the easy one.
  el.root.addEventListener("mousedown", function (e) {
    if (!e.target.closest(".box")) { close(false); }
  });

  el.root.addEventListener("keydown", function (e) {
    // The dialog is modal: it swallows keys so the panel-wide layer cannot also
    // act on them while it is up.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close(false);
    }
  });
}

function close(answer) {
  if (!settle) { return; }
  const done = settle;
  settle = null;
  el.root.classList.remove("open");
  el.root.setAttribute("aria-hidden", "true");
  if (returnFocusTo && returnFocusTo.focus) { returnFocusTo.focus(); }
  returnFocusTo = null;
  done(answer);
}

/**
 * @param {{title?: string, text: string, confirmLabel?: string, danger?: boolean}} opts
 * @returns {Promise<boolean>}
 */
export function askConfirm(opts) {
  cache();
  // No dialog in the document means no way to ask, and silently deleting would
  // be strictly worse than silently not deleting.
  if (!el.root) { return Promise.resolve(false); }
  // A second question while one is up answers the first with "no" rather than
  // stacking two dialogs over each other.
  close(false);

  returnFocusTo = document.activeElement;
  el.title.textContent = opts.title || "Are you sure?";
  el.text.textContent = opts.text || "";
  el.yes.textContent = opts.confirmLabel || "Yes";
  el.yes.classList.toggle("danger", opts.danger !== false);
  el.yes.classList.toggle("primary", opts.danger === false);
  el.root.classList.add("open");
  el.root.setAttribute("aria-hidden", "false");
  // Focus lands on the safe answer, so Enter and Space cannot delete anything.
  el.no.focus();

  return new Promise(function (resolve) { settle = resolve; });
}
