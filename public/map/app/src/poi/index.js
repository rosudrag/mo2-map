// The curated map_markers catalogue: clustering and the pins the manager
// edits.
//
// Layout:
//   state.js        catalogue + filter state + the cluster/priority layer groups
//   icons.js        the pin / town divIcons
//   markers.js      pin construction, popups, visibility, layer rebuild
//
// The catalogue's own filter tree, CRUD panel and #search box are gone:
// manage/filters.js and manage/editor.js render the filter tree and the
// editor from the descriptor in manage/sources/pins.js, and map/query.js plus
// manage/querybox.js own the one global filter query that replaced #search —
// see docs/marker-management.md §9.

import { initState } from "./state.js";
import { buildMarkers, rebuildLayers } from "./markers.js";

/**
 * Boots the catalogue from a /map-data payload: state, pins, then the layers.
 *
 * Called by manage/sources/pins.js — on its first load and again on Refresh, and
 * also with an empty catalogue when /map-data is down. It is therefore
 * idempotent: initState replaces every binding rather than appending, and the
 * layer groups are created at import time so a repeat boot reloads the
 * catalogue instead of duplicating map layers.
 */
export function boot(data) {
  initState(data);
  buildMarkers(data.markers);
  rebuildLayers();
}
