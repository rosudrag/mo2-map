/*
 * The auto-discovery catalogue for the public, API-less build — a committed
 * snapshot applied once instead of the live delta poll, read-only everywhere
 * (the live source's one write, Delete, needs the API key that does not exist
 * here).
 *
 * Every bit of presentation (title, groups, sorts, fields, reveal…) is
 * discoveries-view.js, shared verbatim with the live source in
 * ../discoveries.js. applyDiscoveries() itself — the row<->marker bridge — is
 * discoveries/markers.js, imported directly: that module has never touched
 * discoveries/api.js (only discoveries/sync.js does, and only the live source
 * imports sync.js), so applying a snapshot here carries zero network code.
 */
import { applyDiscoveries, setDiscoveryPopupActions } from "../../../discoveries/markers.js";
import { attachStore, presentation, wireNotifications } from "../discoveries-view.js";
import { loadSnapshot } from "./data.js";

/**
 * Reshapes one static snapshot row into the wire shape
 * discoveries/state.js's normalize() and applyDiscoveries() already expect
 * from a live delta payload: `x`/`y` in UE world metres, `count` the current
 * simultaneous-sightings figure, `*_at` the two dates. World Z and `source`
 * have no slot in that row shape — discoveries/state.js has never tracked
 * either, live or static — so they are read from the snapshot and dropped
 * rather than invented a place to live.
 */
function reshape(raw) {
  const out = [];
  for (const row of raw || []) {
    if (!row || !row.id) { continue; }
    out.push({
      id: String(row.id),
      kind: row.kind,
      class_name: row.class_name,
      label: row.label,
      x: row.world_x,
      y: row.world_y,
      count: row.seen_count,
      observations: row.observations,
      first_seen_at: row.first_seen_date,
      last_seen_at: row.last_seen_date
    });
  }
  return out;
}

function rejectNoWrite(action) {
  return Promise.reject(new Error(
    "Discoveries cannot be " + action + " on the public map — this build has " +
    "no API (can." + (action === "created" ? "create" : "remove") + " is false)."
  ));
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

  ...presentation,

  save: function () { return rejectNoWrite("edited"); },
  create: function () { return rejectNoWrite("created"); },
  remove: function () { return rejectNoWrite("removed"); },

  /**
   * Popup Details → the same read-only sheet the list row's Edit opens.
   * Delete is wired too, into the manager's own removeRows — which is
   * capability-gated and already a safe no-op with can.remove false, exactly
   * as clicking the list's (absent) delete action would be.
   */
  setPopupActions: function (handlers) {
    setDiscoveryPopupActions({
      details: handlers.edit,
      remove: handlers.remove
    });
  }
};

export default source;
