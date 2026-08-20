/*
 * The curated pin catalogue for the public, API-less build — a committed
 * snapshot instead of /map-data, read-only everywhere.
 *
 * Every bit of presentation and rendering (title, groups, sorts, fields, the
 * row<->marker bridge, reveal…) is poi/view.js, shared verbatim with the live
 * source in the private repo's own live pins source. What differs is
 * entirely here: where the rows come from, and that there is nothing to write
 * — this descriptor declares no save/create/remove at all, and never calls
 * poi/markers.js's setMarkerActions, so the pin popup built there renders no
 * Edit / Drag / Delete button (see buildPopupNode's markerActions guard).
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
import { boot } from "../../poi/index.js";
import { iconName } from "../../ui/icons.js";
import { adopt, attachStore, presentation, wireNotifications } from "../../poi/view.js";
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
 * poi/view.js's adopt() already take from the live /map-data payload — the
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

    // v2 pins carry no provenance (no source, no updated_by, no extraction
    // internals) — the only thing left to fold into the read-only "Extra
    // fields" sheet is world position, when the pin has one.
    const meta = {};
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

const source = {
  id: "pins",
  label: "Pins",
  icon: "map-pin",
  can: { create: false, edit: false, remove: false, drag: false, bulk: false },

  attach: function (next) {
    attachStore(next);
    wireNotifications();
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

  ...presentation
};

export default source;
