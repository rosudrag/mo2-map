// Shared state for the curated map_markers catalogue: the category/type
// catalogue, the filter toggles, the marker list and the two Leaflet layer
// groups the pins live in.
//
// This module is the bottom of the poi/ stack: everything under poi/ imports
// it and it imports nothing from poi/. That is what keeps markers, the filter
// panel, search and the editor acyclic — state flows down, and the few calls
// that have to go back up are registered explicitly (see markers.js
// setMarkerActions, modelled on map/click-claim.js).
import { map } from "../map/instance.js";
import { createClusterGroup, createMarkerPane } from "../map/marker-layer.js";

let categories = [];
let typesByCat = {};
let catById = {};
let catEnabled = {};
let typeEnabled = {};
let expanded = {};
let allMarkers = [];

// Declared here, beside the groups that use them, so the stacking order does
// not depend on some other module having been imported first.
createMarkerPane("clusters", 650, "leaflet-cluster-pane");
// Towns above clusters and normal markers.
createMarkerPane("towns", 680);

// The layer groups are created once per page, at import time, rather than per
// initState() call: adding them twice would stack duplicate panes on the map,
// and creating them here pins their add order (cluster, priority, then the
// editor's draft group, which imports this module) without an implicit
// ordering contract between init calls.
//
// Options, clusterclick behaviour and chunked loading come from
// map/marker-layer.js, which the discovery layer shares. `clusterAtMaxZoom` is
// false here so pins sit on their real coordinates once you are all the way in:
// a hand-placed pin's exact spot is the point, and the catalogue is sparse
// enough that unclustering does not smear.
export const clusterGroup = createClusterGroup({
  pane: "clusters",
  radius: 110,
  clusterAtMaxZoom: false
}).addTo(map);

// Towns (clusterable=0) stay as individual pins on the top towns pane.
export const priorityGroup = L.layerGroup().addTo(map);

/**
 * Loads a /map-data payload into module state. Every binding is replaced, so
 * calling this again starts from a clean catalogue instead of appending.
 */
export function initState(data) {
  categories = data.categories.slice().sort(function (a, b) {
    return (a.sort_order || 0) - (b.sort_order || 0);
  });
  typesByCat = data.types || {};
  catById = {};
  categories.forEach(function (c) { catById[c.id] = c; });

  catEnabled = {};
  typeEnabled = {};
  expanded = {};
  categories.forEach(function (c) {
    catEnabled[c.id] = true;
    typeEnabled[c.id] = {};
    (typesByCat[c.id] || []).forEach(function (t) {
      typeEnabled[c.id][t] = true;
    });
  });

  allMarkers = [];
}

// ---- change notification ----
/*
 * One channel, no coalescing — same shape and same reason as
 * discoveries/state.js. The writers here are the filter toggles, which apply
 * a whole intent and then notify ONCE; there is no per-row mutation path to
 * burst.
 *
 * It exists because the catalogue's own filter UI is gone: manage/filters.js and
 * manage/list.js render this state now and they subscribe through
 * manage/sources/pins.js. This is how a toggle reaches them without state.js
 * knowing who draws what — the same rule the file already follows for markers.
 */
const subscribers = [];

export function subscribe(fn) {
  subscribers.push(fn);
}

export function notify() {
  for (const fn of subscribers) { fn(); }
}

// ---- Catalogue ----

export function getCategories() {
  return categories;
}

export function getCategory(id) {
  return catById[id];
}

/** The type labels of a category, always an array. */
export function getTypes(categoryId) {
  return typesByCat[categoryId] || [];
}

/** The raw entry, which older payloads may hand over as an object. */
export function getRawTypes(categoryId) {
  return typesByCat[categoryId];
}

// ---- Filter state ----

export function isCatEnabled(categoryId) {
  return !!catEnabled[categoryId];
}

export function setCatEnabled(categoryId, on) {
  catEnabled[categoryId] = on;
}

/** The per-type toggle map of a category, or undefined when it has no types. */
export function getTypeEnabled(categoryId) {
  return typeEnabled[categoryId];
}

export function setTypeEnabled(categoryId, typeLabel, on) {
  typeEnabled[categoryId][typeLabel] = on;
}

/** A type saved from the editor has to show up under a visible category. */
export function registerSavedType(categoryId, typeLabel) {
  if (!typesByCat[categoryId]) typesByCat[categoryId] = [];
  if (typesByCat[categoryId].indexOf(typeLabel) === -1) typesByCat[categoryId].push(typeLabel);
  if (!typeEnabled[categoryId]) typeEnabled[categoryId] = {};
  typeEnabled[categoryId][typeLabel] = true;
}

export function isExpanded(categoryId) {
  return !!expanded[categoryId];
}

export function setExpanded(categoryId, on) {
  expanded[categoryId] = on;
}

export function toggleExpanded(categoryId) {
  expanded[categoryId] = !expanded[categoryId];
}

// ---- Markers ----

export function getMarkers() {
  return allMarkers;
}

export function addMarker(marker) {
  allMarkers.push(marker);
}

export function removeMarker(marker) {
  const idx = allMarkers.indexOf(marker);
  if (idx !== -1) allMarkers.splice(idx, 1);
}
