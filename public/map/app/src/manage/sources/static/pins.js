/*
 * The curated pin catalogue for the public, API-less build — a committed
 * snapshot instead of /map-data, read-only everywhere.
 *
 * Every bit of presentation and rendering (title, groups, sorts, fields, the
 * row<->marker bridge, reveal…) is pins-view.js, shared verbatim with the live
 * source in ../pins.js. What differs is entirely here: where the rows come
 * from, and that there is nothing to write.
 *
 * pins.json carries no taxonomy — the live catalogue's categories (colour,
 * icon, group_key) are server-owned data with no committed equivalent, and the
 * publish contract is deliberately just rows (id, label, type, category,
 * map_x, map_y, …). So the taxonomy poi/state.js needs is DERIVED from the
 * rows themselves: one synthetic category per distinct `category` value, each
 * given a colour off a small fixed palette and an icon resolved through
 * ui/icons.js — which is exactly the "any name, closed committed set, safe
 * fallback" resolver bookmarks already relies on for the same reason.
 */
import { boot } from "../../../poi/index.js";
import { setMarkerActions } from "../../../poi/markers.js";
import { iconName } from "../../../ui/icons.js";
import { adopt, attachStore, presentation, wireNotifications } from "../pins-view.js";
import { loadSnapshot } from "./data.js";

// Cycled by category index so distinct categories are visually distinct in the
// group filter chips, without inventing a second taxonomy source of truth.
const PALETTE = [
  "#8a6a3d", "#5f8f6a", "#7d7f9a", "#a05a4a",
  "#6f8ba8", "#8a7a63", "#a8823f", "#5a8a9a"
];

function humanize(slug) {
  const s = String(slug || "").replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Uncategorised";
}

/**
 * Reshapes a pins.json snapshot into the SAME canonical
 * `{categories, types, counts, type_counts, markers}` shape boot() and
 * pins-view.js's adopt() already take from the live /map-data payload — the
 * seam that lets this file be small.
 */
function reshape(raw) {
  const catOrder = [];
  const catSeen = Object.create(null);
  const typesByCat = Object.create(null);
  const markers = [];

  for (const row of raw || []) {
    if (!row || !row.id) { continue; }
    const category = String(row.category || "uncategorised");
    if (!catSeen[category]) {
      catSeen[category] = true;
      catOrder.push(category);
      typesByCat[category] = Object.create(null);
    }
    if (row.type) { typesByCat[category][String(row.type)] = true; }

    // Provenance the row shape has no dedicated column for — carried into meta
    // rather than dropped, so it still shows up in the read-only "Extra fields"
    // sheet.
    const meta = Object.assign({}, row.meta && typeof row.meta === "object" ? row.meta : {});
    meta.source = row.source || "seed";
    if (row.updated_by) { meta.updated_by = row.updated_by; }
    if (Number.isFinite(row.world_x)) { meta.world_x = String(row.world_x); }
    if (Number.isFinite(row.world_y)) { meta.world_y = String(row.world_y); }
    if (Number.isFinite(row.world_z)) { meta.world_z = String(row.world_z); }

    markers.push({
      id: String(row.id),
      category: category,
      type: row.type || null,
      name: row.label || null,
      x: Number(row.map_x) || 0,
      y: Number(row.map_y) || 0,
      note: null,
      disposition: null,
      meta: meta
    });
  }

  const categories = catOrder.map(function (id, i) {
    return {
      id: id,
      label: humanize(id),
      color: PALETTE[i % PALETTE.length],
      icon: iconName(id),
      clusterable: true,
      sort_order: i
    };
  });
  const types = Object.create(null);
  for (const cat of catOrder) { types[cat] = Object.keys(typesByCat[cat]).sort(); }

  return { categories: categories, types: types, counts: {}, type_counts: {}, markers: markers };
}

function rejectNoWrite(action) {
  return Promise.reject(new Error(
    "Pins cannot be " + action + " on the public map — this build has no API " +
    "(can." + (action === "created" ? "create" : action === "removed" ? "remove" : "edit") + " is false)."
  ));
}

const source = {
  id: "pins",
  label: "Pins",
  icon: "map-pin",
  can: { create: false, edit: false, remove: false, drag: false, bulk: false },

  attach: function (next) {
    attachStore(next);
    wireNotifications();
    // The pin popup's Edit button still opens the read-only detail sheet (see
    // setPopupActions below); Drag and Delete have nothing to do here, so they
    // stay the inert placeholders every source starts with.
    setMarkerActions({
      edit: function () { /* replaced by setPopupActions */ },
      drag: function () { /* no write, no drag */ },
      askDelete: function () { /* replaced by setPopupActions */ }
    });
  },

  /** Loads the committed snapshot once. Refresh re-reads the same file. */
  load: function () {
    return loadSnapshot("pins.json").then(function (raw) {
      const data = reshape(raw);
      boot(data);
      adopt(data);
    }).catch(function (err) {
      const empty = { categories: [], types: {}, counts: {}, type_counts: {}, markers: [] };
      boot(empty);
      adopt(empty);
      throw err;
    });
  },

  ...presentation,

  save: function () { return rejectNoWrite("edited"); },
  create: function () { return rejectNoWrite("created"); },
  remove: function () { return rejectNoWrite("removed"); },

  /** The pin popup's Edit button → the read-only detail sheet. */
  setPopupActions: function (handlers) {
    setMarkerActions({
      edit: function (mk) {
        if (mk._poi && handlers.edit) { handlers.edit(mk._poi.id); }
      },
      drag: function () { /* no write, no drag */ },
      askDelete: function () { /* no write, nothing to delete */ }
    });
  }
};

export default source;
