/*
 * The auto-discovery catalogue for the public, API-less build — a committed
 * snapshot applied once instead of the live delta poll, read-only everywhere
 * (the live source's one write, Delete, needs the API key that does not exist
 * here).
 *
 * Every bit of presentation (title, groups, sorts, fields, reveal…) is
 * discoveries/view.js, shared verbatim with the live source in the private
 * repo's own live discoveries source. applyDiscoveries() itself — the
 * row<->marker bridge — is discoveries/markers.js, imported directly: that
 * module has never touched discoveries/api.js (only discoveries/sync.js does,
 * and only the live source imports sync.js), so applying a snapshot here
 * carries zero network code.
 *
 * This descriptor declares no save/create/remove and never calls
 * discoveries/markers.js's setDiscoveryPopupActions, so the discovery popup
 * built there renders no Details / Delete button (see popupHtml's
 * popupActions guard).
 */
import { applyDiscoveries } from "../../discoveries/markers.js";
import { attachStore, presentation, wireNotifications } from "../../discoveries/view.js";
import { loadSnapshot } from "./data.js";

/**
 * Reshapes one static snapshot row (contract: id, kind, label, x, y, z,
 * count) into the wire shape discoveries/state.js's normalize() and
 * applyDiscoveries() already expect from a live delta payload: `x`/`y` in UE
 * world metres, `count` the number of nodes merged into the row.
 *
 * A published row is NAMED, not classed: the exporter folds the engine class
 * name into `label` before publishing, so the snapshot never carries a `cls`
 * (or `class_name`) field at all, and none is read or invented here.
 * normalize() (discoveries/state.js) already treats an absent `class_name`
 * as "this row has no class" — it falls back `className` to `""` — and the
 * shared popup/detail-sheet/search code (markers.js, view.js) already gate
 * on that presence, because the live source's rows (private repo) still
 * carry a real `class_name` from the API and must keep showing it. `z` has
 * no slot in this row shape either — discoveries/state.js has never tracked
 * elevation — so it is read from the snapshot and dropped rather than
 * invented a place to live. The snapshot no longer publishes observations or
 * first/last-seen timestamps at all (the v2 contract strips them), so
 * normalize() falls back to its own defaults for those exactly as it already
 * does for a live row that omits them.
 */
function reshape(raw) {
  const out = [];
  for (const row of raw || []) {
    if (!row || !row.id) { continue; }
    out.push({
      id: String(row.id),
      kind: row.kind,
      label: row.label,
      x: row.x,
      y: row.y,
      count: row.count
    });
  }
  return out;
}

const source = {
  id: "discoveries",
  label: "Discoveries",
  icon: "sparkles",
  can: { create: false, edit: false, remove: false, drag: false, bulk: false },

  attach: function (next) {
    attachStore(next);
    wireNotifications();
  },

  /** Applies the committed snapshot once. Refresh re-reads the same file. */
  load: function () {
    return loadSnapshot("discoveries.json").then(function (raw) {
      applyDiscoveries(reshape(raw));
    });
  },

  ...presentation
};

export default source;
