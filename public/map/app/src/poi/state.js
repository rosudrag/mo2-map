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
// Whether a marker this catalogue is about to build should ever be
// construction-time draggable. Read from the OPTIONAL `data.can` a source's
// load() hands to initState() (via poi/index.js's boot()); a source that
// omits it — every source until this flag existed — gets `true`, so the live
// catalogue's own editable behaviour does not change by not opting in.
//
// This exists because `draggable: true` used to be unconditional in
// makePoiMarker regardless of `can.drag`: Leaflet stamps the
// `leaflet-marker-draggable` CSS class onto a marker's icon the moment a
// draggable-by-construction marker is added to the map (dragging.enable()
// runs inside its own onAdd), before poi/view.js's watchMarker() gets a
// chance to call dragging.disable() and strip it back off. On a source with
// no editor to ever call dragging.enable() again (the public, static build)
// that is a pointless flash of drag affordance in the DOM for a pin nothing
// can move — cheaper and more honest to never construct the marker as
// draggable in the first place.
let dragCapable = true;

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
  dragCapable = data.can ? !!data.can.drag : true;
}

export function isDragCapable() {
  return dragCapable;
}

/**
 * Whether `id` names a category whose points are PLACE NAMES: permanently
 * labelled, never clustered, drawn on the top "towns" pane (poi/markers.js's
 * `labelled`/`priority` and poi/icons.js's poiIcon()). Two spellings of one
 * concept because two different producers name it: the live catalogue this
 * app is booted with (a downstream consumer) calls the category "towns"
 * (plural, its own long-standing id); the v3 snapshot
 * (sources/static/points.js) calls it "town" (singular — manifest.json's own
 * id, since the static build never had this category before v3). Centralised
 * here, the bottom of the poi/ stack, so nothing above re-decides "is this a
 * town" by string comparison a third time — map/poster.js's own labelling
 * check imports this too.
 */
export function isTownCategory(id) {
  return id === "towns" || id === "town";
}

// ---- change notification ----
/*
 * One channel, no coalescing — same shape and same reason as
 * discoveries/state.js. The writers here are the filter toggles, which apply
 * a whole intent and then notify ONCE; there is no per-row mutation path to
 * burst.
 *
 * It exists because the catalogue's own filter UI is gone: view/filters.js and
 * the row list on whichever build has one render this state now, subscribing
 * through poi/view.js. This is how a toggle reaches them without state.js
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
