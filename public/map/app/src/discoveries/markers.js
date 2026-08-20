/*
 * Discovery pins: icon construction, popups, the delta application and the
 * cluster/isolation rendering.
 *
 * These rows are machine-made. Nobody chose to put them here — repeated
 * sightings of the same class in the same place are merged into one row.
 * Authoring is off the table (no create, no drag, no field edits), but
 * Delete IS on the popup: a bad auto-pin is noticed on the map, and walking
 * to the private map's Discoveries tab to tombstone it is the friction this
 * removes. The write still goes through the private repo's live discoveries
 * source, so confirm + optimistic rollback stay in one place.
 *
 * Coordinates arrive as UE world METRES and become canvas coordinates through
 * worldToMap() and nothing else. The projection constants live with the map art
 * they describe (data/markers.js) — a copy here would be a second source of
 * truth that silently rots the next time the art is refitted.
 *
 * This file never imports ./api.js — sync.js does, and only sync.js. Every
 * function here takes rows it is handed rather than fetching them itself, which
 * is what lets a static build apply a committed snapshot through
 * applyDiscoveries() and render the exact same pins with zero network code in
 * its bundle.
 */
import { map } from "../map/instance.js";
import { coalesced, delegatePopupActions } from "../map/marker-layer.js";
import { escapeHtml } from "../util/html.js";
import { TABLER } from "../util/assets.js";
import { worldToMap } from "../map/projection.js";
import { onMapChange } from "../map/active-map.js";
import {
  discoveryCluster,
  discoveryVisible,
  dropRow,
  kindMeta,
  notify,
  putRow,
  restoreRow
} from "./state.js";

const markers = Object.create(null);
const iconCache = Object.create(null);

/*
 * Discovery pins are deliberately NOT the curated .map-pin: a faded, dashed
 * ring says "this was machine-observed" where a solid pin says "a person placed this
 * here on purpose". The two carry very different confidence and users act on
 * them differently — a curated pin is worth a detour, a scraped one is worth a
 * glance — so the distinction has to survive a screenshot, not just a popup.
 *
 * Memoised per kind+count: plain pins are interchangeable and a full catalogue
 * runs to 10^4-10^5 rows over a handful of distinct counts.
 */
function discoveryIcon(meta, count) {
  const key = meta.slug + "|" + count;
  if (!iconCache[key]) {
    iconCache[key] = L.divIcon({
      className: "",
      html: '<div class="disco-pin" style="--pin:' + meta.color +
        '"><img src="' + TABLER + meta.icon + '.svg" alt="" width="13" height="13" />' +
        (count > 1 ? '<span class="disco-count">' + count + "</span>" : "") +
        "</div>",
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -14]
    });
  }
  return iconCache[key];
}

/** `Cepa ×12`, `Kebechet Cultist ×7` — the count only earns space when it is news. */
function labelFor(row) {
  return row.count > 1 ? row.label + " \u00d7" + row.count : row.label;
}

/*
 * Popup buttons go through ONE delegated listener on the map container —
 * Leaflet rebuilds popup DOM on every open, so per-popup listeners would leak
 * a handler per render. The dispatch itself lives in map/marker-layer.js
 * because the bookmark layer needs exactly the same thing.
 */
const setActions = delegatePopupActions("disco");

// Set by the source's setPopupActions (the private repo's live discoveries
// source, via its panel's mount()). The public, static build's read-only
// source never calls this, so it stays null and popupHtml below renders no
// action buttons at all — not even inert ones.
let popupActions = null;

/** Registers { details, remove } from the live discoveries source. */
export function setDiscoveryPopupActions(handlers) {
  popupActions = handlers;
  setActions({ details: handlers.details, delete: handlers.remove });
}

/*
 * Extra `<dt>/<dd>` fact rows for the popup, supplied by whoever owns the row's
 * meaning.
 *
 * A row's `count` means different things on either side of the seam: to the
 * live source it is how many were seen at one time, to a published snapshot it
 * is how many nodes were merged into the row. One renderer cannot label both
 * honestly, and the words for the live meaning have no business in a build
 * that never has that data. So the shared popup renders what is true of any
 * row - what it is, and its label - plus its class WHEN it has one, and a
 * source adds its own facts.
 */
let popupFacts = null;

export function setDiscoveryPopupFacts(fn) {
  popupFacts = fn;
}

// The .marker-popup wrapper is what leaflet.css styles; a string handed to
// bindPopup lands straight in the popup's content node, so this template has to
// carry the class the curated popups get from their built element.
function popupHtml(row) {
  const meta = kindMeta(row.kind);
  const id = escapeHtml(row.id);
  // Details opens the read-only detail sheet; Delete tombstones via the same
  // confirm path as the row list's 🗑 — noticed on the map, fixed without a
  // panel hunt. Neither exists unless a source registered a handler for it.
  let actions = "";
  if (popupActions && (popupActions.details || popupActions.remove)) {
    actions = '<div class="popup-actions">' +
      (popupActions.details
        ? '<button type="button" data-disco-pop="details" data-disco-id="' + id + '">Details</button>'
        : "") +
      (popupActions.remove
        ? '<button type="button" class="danger" data-disco-pop="delete" data-disco-id="' + id +
          '" title="Hide this pin — it is not re-added from the data feed">Delete</button>'
        : "") +
      "</div>";
  }
  // Everything below the kind line comes from whoever owns the row's meaning.
  // A published row is a name, a kind and a position, so it has no facts at
  // all and gets no list; the live source registers its own.
  const facts = popupFacts ? popupFacts(row) : "";
  return '<div class="marker-popup disco-popup">' +
    "<h5>" + escapeHtml(labelFor(row)) + "</h5>" +
    '<div class="layer"><img src="' + TABLER + meta.icon +
    '.svg" alt="" width="14" height="14" />' + escapeHtml(meta.label) + "</div>" +
    (facts ? '<dl class="disco-facts">' + facts + "</dl>" : "") +
    actions + "</div>";
}

/*
 * Leaflet accepts a function as popup content and calls it when the popup opens.
 * Building 10^5 popup strings at load time to show at most one of them is the
 * kind of eager work that turns a map into a stutter.
 */
function popupContent(layer) {
  return popupHtml(layer._discovery);
}

/** The marker for one row, or null when the row falls outside the calibration. */
function makeMarker(row) {
  const at = worldToMap(row.x, row.y);
  if (!at) { return null; }
  const meta = kindMeta(row.kind);
  const marker = L.marker([at.lat, at.lng], {
    icon: discoveryIcon(meta, row.count),
    title: labelFor(row),
    pane: "discoveries"
  });
  marker._discovery = row;
  // minWidth is the other half of the collapse fix in discoveries.css: Leaflet
  // sizes the popup wrapper from content, and an all-breakable token reports a
  // one-character minimum. maxWidth keeps a 40-char class from stretching it.
  marker.bindPopup(popupContent, { minWidth: 196, maxWidth: 300 });
  return marker;
}

/**
 * Adopts one payload's worth of rows: upsert by id, and REMOVE any row that
 * arrives with `status: "deleted"` — the tombstone is the only signal a delta
 * reader ever gets that a row is gone.
 *
 * Batched through addLayers/removeLayers rather than a layer at a time: the
 * boot payload is the whole catalogue, and markercluster's bulk path builds the
 * cluster tree once instead of re-splicing it per marker.
 */
export function applyDiscoveries(list) {
  const toAdd = [];
  const toRemove = [];
  for (const raw of list || []) {
    if (!raw || !raw.id) { continue; }
    const id = String(raw.id);
    const existing = markers[id];
    if (existing) {
      if (discoveryCluster.hasLayer(existing)) { toRemove.push(existing); }
      // The isolated pin is on the map itself, not in the group, so the bulk
      // removeLayers below would miss it and leave a stale pin behind forever.
      if (id === isolatedId) { releaseIsolated(true); }
      delete markers[id];
    }
    if (raw.status === "deleted") {
      dropRow(id);
      continue;
    }
    const row = putRow(raw);
    const marker = makeMarker(row);
    // A row we cannot project is kept in state but drawn nowhere: it still
    // counts in the filter section, so an off-map calibration shows up as a
    // number with no pins instead of vanishing without trace.
    if (!marker) { continue; }
    markers[id] = marker;
    if (discoveryVisible(row)) { toAdd.push(marker); }
  }
  if (toRemove.length) { discoveryCluster.removeLayers(toRemove); }
  if (toAdd.length) { discoveryCluster.addLayers(toAdd); }
  notify();
}

/*
 * ---- isolation ------------------------------------------------------------
 *
 * One pin, lifted OUT of the cluster group and onto the map as itself.
 *
 * These rows cluster at EVERY zoom (state.js explains why: two rows 9 m apart
 * are a legitimate pair and drew smeared on top of each other when clustering
 * stopped at maxZoom). That is right for browsing and wrong for the one gesture
 * where the user has already NAMED the row they want — picking it out of the
 * Discoveries list. Flying to a bubble labelled `128` and asking someone to
 * find their row inside it is not revealing anything.
 *
 * Spiderfying was the other candidate and loses: it explodes the whole
 * neighbourhood into a wheel of identical pins, which is more to read, not
 * less, and it collapses again on the next map move.
 *
 * The isolated marker keeps its `discoveries` pane, so nothing about stacking
 * order changes — it simply stops being clustered. Exactly one row may be
 * isolated: this is a spotlight, not a second visibility system.
 */
let isolatedId = null;

/**
 * Puts the isolated pin back where it belongs.
 *
 * `keepOff` is for the case where the marker is about to be discarded (a delta
 * replaced it, or the row was deleted): returning it to the cluster first would
 * add a layer the caller is one line away from having to remove again.
 */
function releaseIsolated(keepOff) {
  if (isolatedId === null) { return; }
  const marker = markers[isolatedId];
  isolatedId = null;
  if (!marker) { return; }
  if (map.hasLayer(marker)) { map.removeLayer(marker); }
  if (!keepOff && discoveryVisible(marker._discovery)) { discoveryCluster.addLayer(marker); }
}

/**
 * Draws one row's pin on its own, outside the cluster, and returns the marker
 * (null when the row has no pin — an unprojectable position — or a filter is
 * currently hiding it, in which case isolating would resurrect a row the user
 * asked not to see).
 */
export function isolateDiscovery(id) {
  const marker = markers[id];
  if (!marker || !discoveryVisible(marker._discovery)) {
    releaseIsolated();
    return null;
  }
  if (isolatedId === id) { return marker; }
  releaseIsolated();
  if (discoveryCluster.hasLayer(marker)) { discoveryCluster.removeLayer(marker); }
  marker.addTo(map);
  isolatedId = id;
  return marker;
}

/** Ends the spotlight: the pin rejoins the cluster if it is still visible. */
export function clearDiscoveryIsolation() {
  releaseIsolated();
}

/**
 * Re-derives the cluster group's contents from the filter / search-focus state.
 * Filtering adds and removes real layers rather than hiding pins with CSS: a
 * hidden marker is still a marker as far as clustering is concerned, so a CSS
 * filter would leave bubbles counting pins the user asked not to see.
 *
 * Coalesced for the same reason as poi/markers.js: one gesture in the filter
 * panel calls this once per kind — Show all calls it six times, each clearing
 * and refilling a 1,500-marker cluster tree. See map/marker-layer.js.
 */
export const rebuildDiscoveryLayer = coalesced(function () {
  // A filter that hides the isolated row ends the spotlight: the pin is on the
  // map directly, so nothing the cluster rebuild does below would take it off.
  if (isolatedId !== null) {
    const held = markers[isolatedId];
    if (!held || !discoveryVisible(held._discovery)) { releaseIsolated(); }
  }
  discoveryCluster.clearLayers();
  const visible = [];
  for (const id of Object.keys(markers)) {
    if (id === isolatedId) { continue; }
    if (discoveryVisible(markers[id]._discovery)) { visible.push(markers[id]); }
  }
  if (visible.length) { discoveryCluster.addLayers(visible); }
}).schedule;

// discoveryVisible() (state.js) already gates on the active map, but a map
// switch touches no row and fires no delta — nothing else would ever tell the
// cluster tree to drop the pins that just fell out of view (or add back the
// ones that came into it).
onMapChange(rebuildDiscoveryLayer);

/*
 * The two halves of an optimistic delete, which is the ONE write this page makes
 * to the discovery catalogue (DELETE /discoveries/{id} — hiding a bad row is
 * legitimate; authoring one only happens upstream).
 *
 * They are local-only on purpose: the request lives in the source adapter, which
 * owns the snapshot and the rollback, and this module only knows how to put a
 * pin on the map or take it off. Both are called by the private repo's live
 * discoveries source and nothing else.
 */
export function dropDiscovery(id) {
  const marker = markers[id];
  if (marker) {
    if (id === isolatedId) { releaseIsolated(true); }
    if (discoveryCluster.hasLayer(marker)) { discoveryCluster.removeLayer(marker); }
    delete markers[id];
  }
  dropRow(id);
  notify();
}

/** Puts a row and its pin back after a delete the server refused. */
export function readdDiscovery(row) {
  restoreRow(row);
  const marker = makeMarker(row);
  if (!marker) { return; }
  markers[row.id] = marker;
  if (discoveryVisible(row)) { discoveryCluster.addLayer(marker); }
  notify();
}

