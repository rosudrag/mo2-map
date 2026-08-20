/*
 * Everything about the curated pin catalogue that is presentation and
 * rendering, not transport: the row<->marker bridge, the list/editor
 * descriptor pieces (title, groups, sorts, fields…) and reveal-on-the-map.
 * Both the private repo's own live pins source (the live source, full CRUD)
 * and this package's sources/static/pins.js (the read-only public build)
 * build their descriptor by spreading `presentation` over their own
 * id/can/attach/load — and, live only, save/remove/create — which is the
 * actual difference between "rows arrive from /map-data" and "rows arrive
 * once from a committed snapshot".
 *
 * TWO THINGS ARE SPECIFIC TO THIS SOURCE AND SURVIVE AS CONTRACT MEMBERS
 * RATHER THAN AS SPECIAL CASES — carried over unchanged from pins.js:
 *
 *   Rows are CANVAS PIXELS, not world metres. `map_markers.map_x/map_y` are
 *   positions on the map art (docs/map-coordinates.md), so latLng returns them
 *   as they are and the coords field converts the other way for the readout.
 *
 *   The taxonomy has TWO levels. A category has types, each with its own toggle
 *   and count, hence subGroups/isSubGroupEnabled/setSubGroupEnabled, and the
 *   presets built from `category.group_key`.
 *
 * Nothing here imports poi/api.js. Every function operates on rows already in
 * poi/state.js, however they got there — normalizePin and adopt() take the
 * SAME canonical `{categories, types, counts, type_counts, markers}` shape
 * boot() does, whether it came from loadMapData() or a static JSON snapshot
 * reshaped to match it. That symmetry is what lets a static build import this
 * module with zero network code in its bundle.
 *
 * The one write-adjacent thing that DOES live here is drag: watchMarker always
 * wires the drop handler set by attachDragEnd(), because dragging itself is
 * gated by editMode (never true when can.drag is false, so the marker is never
 * enabled to drag in the first place) rather than by whether a handler exists.
 * A source that never calls attachDragEnd() simply never has one to fire.
 */
import { subscribe as subscribeQuery } from "../map/query.js";
import { map } from "../map/instance.js";
import { mapOf } from "../map/active-map.js";
import {
  addMarker, clusterGroup, getCategories, getCategory, getMarkers,
  getTypeEnabled, getTypes, isCatEnabled, notify, priorityGroup, setCatEnabled,
  setTypeEnabled, subscribe
} from "./state.js";
import {
  flushLayerRebuild, makePoiMarker, markerVisible, rebuildLayers,
  removeMarkerFromMap, visibleCountFor
} from "./markers.js";
import { rebuildDiscoveryLayer } from "../discoveries/markers.js";
import { GROUPS, ROWS } from "../registry/store.js";

let store = null;

export function attachStore(next) {
  store = next;
}

/**
 * Wires the two change channels every pins descriptor needs: a category/type
 * filter toggle (poi/state.js's own notify) mirrors into the store, and the
 * global query narrows this layer too (poi/markers.js markerVisible), so a
 * keystroke rebuilds the cluster the same way a filter toggle does —
 * coalesced, so a burst of keystrokes collapses.
 */
export function wireNotifications() {
  subscribe(function () { store.notify(ROWS, GROUPS); });
  subscribeQuery(function () {
    rebuildLayers();
    store.notify(ROWS, GROUPS);
  });
}

// id -> Leaflet marker. poi/state.js keeps the markers in an array because its
// own renderers only ever iterate them; editing one needs it by id.
const pins = Object.create(null);

/**
 * Registers the live source's drag-to-move handler. Optional: a source that
 * never calls this (the static build) never wires a dragend listener, and
 * since editMode never becomes true when can.drag is false, dragging is never
 * enabled on a marker in the first place — the handler would have nothing to
 * fire from even if it existed.
 */
let dragEndHandler = null;
export function attachDragEnd(fn) {
  dragEndHandler = fn;
}

/*
 * The row is the truth and the marker is a projection of it.
 *
 * poi/state.js used to hold the only copy, on `marker._poi`, which is why every
 * edit in poi/editor.js had to destroy and rebuild the marker to change a field.
 * Keeping the authored values in the store instead is what lets the list, the
 * editor and the filter section read a pin without touching Leaflet — and the
 * rebuild still happens on save, because the icon, the popup and the cluster
 * membership all derive from the category.
 */
export function normalizePin(m) {
  const cat = getCategory(m.category);
  const rawName = m.name ? String(m.name) : null;
  const type = m.type ? String(m.type) : null;
  return {
    id: String(m.id),
    // Which map the pin is on. mapOf() applies the one rule for a row with no
    // map: it predates them, so it is on the surface.
    map: mapOf(m),
    category: String(m.category),
    type: type,
    rawName: rawName,
    // The same fallback chain makePoiMarker uses for its title, so the list and
    // the pin never disagree about what a row is called.
    name: rawName || type || (cat ? cat.label : String(m.category)),
    lat: Number(m.y),
    lng: Number(m.x),
    note: m.note ? String(m.note) : null,
    disposition: m.disposition ? String(m.disposition) : null,
    // Carried through untouched. The upsert overwrites meta_json with whatever
    // the request holds, so dropping it here would silently erase the import
    // provenance on the 845 mo2map rows the first time anyone edited one.
    meta: m.meta && typeof m.meta === "object" ? m.meta : null
  };
}

/** The payload makePoiMarker wants, which is a read row rather than a write. */
export function toMarkerData(row) {
  const cat = getCategory(row.category);
  return {
    id: row.id,
    map: row.map,
    category: row.category,
    category_label: cat ? cat.label : row.category,
    type: row.type,
    name: row.rawName,
    x: row.lng,
    y: row.lat,
    note: row.note,
    disposition: row.disposition,
    icon: cat ? cat.icon : "map-pin",
    color: cat ? cat.color : "#8a6a3d",
    clusterable: cat ? cat.clusterable : true
  };
}

export function watchMarker(mk) {
  pins[mk._poi.id] = mk;
  if (dragEndHandler) { mk.on("dragend", dragEndHandler); }
  if (mk.dragging) {
    if (store.getView().editMode) { mk.dragging.enable(); } else { mk.dragging.disable(); }
  }
}

export function detach(id) {
  const mk = pins[id];
  if (!mk) { return; }
  removeMarkerFromMap(mk);
  delete pins[id];
}

/** Rebuilds one pin from its row: icon, popup and cluster membership all follow. */
export function renderPin(id) {
  const row = store.getRow(id);
  detach(id);
  if (!row) { return; }
  const mk = makePoiMarker(toMarkerData(row));
  addMarker(mk);
  watchMarker(mk);
}

/** Toggles drag on every live marker to match the current edit-mode state. */
export function syncDragging() {
  const editMode = store.getView().editMode;
  for (const id of Object.keys(pins)) {
    const mk = pins[id];
    if (!mk.dragging) { continue; }
    if (editMode) { mk.dragging.enable(); } else { mk.dragging.disable(); }
  }
}

/**
 * Adopts a canonical `{markers: [...]}` payload into both the store and the
 * poi/state.js marker layers boot() already built for it.
 *
 * A reload replaces the catalogue rather than merging into it: initState has
 * already dropped the old markers, so a row that is gone from the payload must
 * not survive in the store as a pin nothing can click.
 */
export function adopt(data) {
  const rows = [];
  for (const m of data.markers || []) {
    if (!m || !m.id) { continue; }
    rows.push(normalizePin(m));
  }
  for (const id of store.rowIds()) { store.dropRow(id); }
  for (const id of Object.keys(pins)) { delete pins[id]; }
  store.adoptRows(rows);
  for (const mk of getMarkers()) { watchMarker(mk); }
}

// ---- fields ------------------------------------------------------------------
/*
 * category is a `pick` (a menu), not a slug: the catalogue's categories are a
 * closed set that only a migration adds to, and a typo would silently file the
 * pin under a category nothing renders. type is a `slug` because naming a new one
 * IS how a type is created — registerSavedType (pins.js, live only) is the other
 * half of that.
 *
 * A native <select> is not an option here: they fail to open in an embedded
 * browser view, which is why poi/editor.js hand-rolled its pickers and why the
 * `pick` field type exists.
 */
export const fields = [
  { key: "name", label: "Name", type: "text", maxLength: 120, primary: true },
  {
    key: "category",
    label: "Category",
    type: "pick",
    options: function () {
      return getCategories().map(function (c) {
        return { value: c.id, label: c.label, color: c.color };
      });
    }
  },
  {
    key: "type",
    label: "Type",
    type: "slug",
    options: function () {
      // Every type in the catalogue, not only the current category's: the field
      // is a suggestion list and the category may be about to change.
      const seen = Object.create(null);
      for (const c of getCategories()) {
        for (const t of getTypes(c.id)) { seen[String(t)] = true; }
      }
      return Object.keys(seen).sort();
    }
  },
  {
    key: "disposition",
    label: "Disposition",
    type: "slug",
    // Free text on the server (VARCHAR(32)), so the suggestions are the values
    // actually in use rather than a vocabulary invented here.
    options: function () {
      const seen = Object.create(null);
      for (const row of store.activeRows()) {
        if (row.disposition) { seen[row.disposition] = true; }
      }
      return Object.keys(seen).sort();
    }
  },
  { key: "note", label: "Note", type: "note", maxLength: 2000 },
  { key: "meta", label: "Extra fields", type: "meta" },
  { key: "coords", label: "Position", type: "coords" }
];

// ---- presets -----------------------------------------------------------------
/*
 * Travel / Gathering / Finds were three hard-coded buttons in index.html keyed on
 * `category.group_key`. Derived instead, so a taxonomy that grows a fourth group
 * gets its button for free and one that drops a group does not leave a dead one.
 */
function presets() {
  const order = [];
  const byKey = Object.create(null);
  for (const c of getCategories()) {
    const key = c.group_key;
    if (!key) { continue; }
    if (!byKey[key]) {
      byKey[key] = { id: key, label: key.charAt(0).toUpperCase() + key.slice(1), groupIds: [] };
      order.push(key);
    }
    byKey[key].groupIds.push(c.id);
  }
  return order.map(function (k) { return byKey[k]; });
}

/** The descriptor members every pins source shares, regardless of `can`. */
export const presentation = {
  onChange: function (fn) {
    store.subscribe([ROWS, GROUPS], fn);
  },

  rows: function () {
    return store.activeRows();
  },

  rowId: function (row) {
    return row.id;
  },

  title: function (row) {
    return row.name || "(unnamed)";
  },

  subtitle: function (row) {
    const cat = getCategory(row.category);
    const bits = [cat ? cat.label : row.category];
    if (row.type && row.type !== row.name) { bits.push(row.type); }
    if (row.disposition) { bits.push(row.disposition); }
    return bits.join(" · ");
  },

  iconName: function (row) {
    const cat = getCategory(row.category);
    return (cat && cat.icon) || "map-pin";
  },

  accent: function (row) {
    const cat = getCategory(row.category);
    return (cat && cat.color) || "#8a6a3d";
  },

  /*
   * Already canvas pixels — map_markers stores positions on the map art, so there
   * is nothing to project. The editor's coords field converts the other way to
   * show world metres beside them.
   */
  latLng: function (row) {
    return { lat: row.lat, lng: row.lng };
  },

  searchText: function (row) {
    return (row.name + " " + row.category + " " + (row.type || "") + " " +
      (row.disposition || "") + " " + (row.note || "")).toLowerCase();
  },

  /*
   * VISIBLE counts, not row counts: a category showing "12" while its type
   * toggles hide eleven of them is the number disagreeing with the map. This is
   * what poi/filter-panel.js showed and why visibleCountFor exists.
   */
  groups: function () {
    return getCategories().map(function (c) {
      return {
        id: c.id,
        label: c.label,
        color: c.color,
        icon: c.icon,
        count: visibleCountFor(c.id)
      };
    });
  },

  groupOf: function (row) {
    return row.category;
  },

  /**
   * Whether `row` earns a marker right now — category/type toggle, active
   * map and the global query, the exact gate markers.js applies when it
   * rebuilds the layer. Shared rather than re-derived so the search summary
   * (view/search.js) can never report a match the map itself does not draw.
   */
  visible: markerVisible,

  isGroupEnabled: function (groupId) {
    return isCatEnabled(groupId);
  },

  /*
   * Toggling a category takes its types with it.
   */
  setGroupEnabled: function (groupId, on) {
    setCatEnabled(groupId, on);
    for (const t of getTypes(groupId)) { setTypeEnabled(groupId, t, on); }
    rebuildLayers();
    rebuildDiscoveryLayer();
    notify();
  },

  subGroups: function (groupId) {
    const cat = getCategory(groupId);
    return getTypes(groupId).map(function (t) {
      return {
        id: t,
        label: t,
        color: cat ? cat.color : "#8a6a3d",
        icon: cat ? cat.icon : "map-pin",
        count: visibleCountFor(groupId, t)
      };
    });
  },

  isSubGroupEnabled: function (groupId, subId) {
    const te = getTypeEnabled(groupId);
    if (!te) { return true; }
    return te[subId] !== false;
  },

  /*
   * The cascade from poi/filter-panel.js, kept because both halves are load
   * bearing: switching a type ON has to switch its category on (otherwise the
   * click does nothing visible), and switching the LAST type off switches the
   * category off (otherwise an empty category keeps claiming to be enabled).
   */
  setSubGroupEnabled: function (groupId, subId, on) {
    const te = getTypeEnabled(groupId);
    if (!te) { return; }
    setTypeEnabled(groupId, subId, on);
    if (on) { setCatEnabled(groupId, true); }
    const anyOn = Object.keys(te).some(function (k) { return te[k]; });
    if (!anyOn) { setCatEnabled(groupId, false); }
    rebuildLayers();
    rebuildDiscoveryLayer();
    notify();
  },

  presets: presets,

  layerOn: function () {
    return store.getView().layerOn;
  },

  /*
   * Both groups leave the map, cluster and priority: the towns group is not
   * clusterable and lives in its own group, so removing only the cluster would
   * leave the town pins behind on a layer the user just switched off.
   */
  setLayerOn: function (on) {
    store.setLayerOn(on);
    if (on) {
      clusterGroup.addTo(map);
      priorityGroup.addTo(map);
      rebuildLayers();
    } else {
      map.removeLayer(clusterGroup);
      map.removeLayer(priorityGroup);
    }
  },

  sorts: [
    {
      value: "name",
      label: "Name",
      compare: function (a, b) {
        const an = a.name.toLowerCase();
        const bn = b.name.toLowerCase();
        if (an === bn) { return 0; }
        return an < bn ? -1 : 1;
      }
    },
    {
      value: "category",
      label: "Category",
      compare: function (a, b) {
        if (a.category !== b.category) { return a.category < b.category ? -1 : 1; }
        const at = (a.type || "") + a.name;
        const bt = (b.type || "") + b.name;
        return at < bt ? -1 : at > bt ? 1 : 0;
      }
    }
  ],

  fields: fields,

  toForm: function (row) {
    return {
      // The AUTHORED name, not the display name: `name` falls back to the type
      // and then to the category label, and seeding the form with that fallback
      // would turn "unnamed Ibex" into a row literally called Ibex on save.
      name: row.rawName || "",
      category: row.category,
      type: row.type || "",
      disposition: row.disposition || "",
      note: row.note || "",
      meta: row.meta ? Object.assign({}, row.meta) : {},
      coords: { lat: row.lat, lng: row.lng }
    };
  },

  /**
   * Fly to a pin and open its popup.
   *
   * rebuildLayers() is coalesced onto a microtask, so a filter change made in
   * the same turn as this reveal has not reached the cluster group yet and
   * hasLayer would answer about the previous filter state — flushLayerRebuild
   * forces it first.
   *
   * Through the cluster group when it owns the pin: a clustered marker is not
   * on the map, so opening its popup directly does nothing until the cluster
   * has zoomed apart.
   */
  reveal: function (id) {
    const row = store.getRow(id);
    if (!row) { return; }
    store.setView({ activeId: id, anchorId: id });
    const mk = pins[id];
    if (!mk) { return; }
    flushLayerRebuild();
    if (mk._poi.clusterable && clusterGroup.hasLayer(mk)) {
      clusterGroup.zoomToShowLayer(mk, function () { mk.openPopup(); });
      return;
    }
    map.setView([row.lat, row.lng], Math.max(map.getZoom(), 1));
    mk.openPopup();
  }
};
