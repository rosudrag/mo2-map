// The curated map_markers catalogue: clustering and the pins a private,
// full-CRUD build edits.
//
// Layout:
//   state.js        catalogue + filter state + the cluster/priority layer groups
//   icons.js        the pin / town divIcons
//   markers.js      pin construction, popups, visibility, layer rebuild
//
// The catalogue's own filter tree, CRUD panel and #search box are gone:
// view/filters.js renders the filter tree from the descriptor in
// poi/view.js, the private repo's own row list and field editor render from
// the same descriptor for the build that has them, and map/query.js plus
// view/search.js own the one global filter query that replaced #search.

import { initState } from "./state.js";
import { buildMarkers, rebuildLayers } from "./markers.js";

/**
 * Boots the catalogue from a /map-data payload: state, pins, then the layers.
 *
 * Called by every pins source (poi/view.js's shared load path) — on its first load and again on Refresh, and
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
