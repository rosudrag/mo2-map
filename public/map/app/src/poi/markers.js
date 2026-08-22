// Pin construction, popups, visibility and the cluster/priority layer rebuild.
import { escapeHtml } from "../util/html.js";
import { markerIcon, resolveIconSrc, townIcon } from "./icons.js";
import { map } from "../map/instance.js";
import { coalesced } from "../map/marker-layer.js";
import {
  clusterGroup,
  priorityGroup,
  addMarker,
  getCategory,
  getMarkers,
  getTypeEnabled,
  isCatEnabled,
  isDragCapable,
  isTownCategory,
  removeMarker
} from "./state.js";
import { matches } from "../map/query.js";
import { mapOf, onActiveMap, onMapChange } from "../map/active-map.js";

// The popup's Edit / Drag / Delete buttons drive the editor panel, which sits
// above this module and imports it. Registering the three handlers keeps the
// dependency pointing one way instead of closing an import cycle — same slot
// pattern as map/click-claim.js.
let markerActions = null;
// Same slot pattern for the dungeon map (map/dungeonmode.js): a pin that names a
// dungeon offers a way in. Registered rather than imported because dungeonmode
// imports this module to ask what a marker is.
let dungeonLink = null;
// Same idea again, for one read-only fact line under the category line — e.g.
// sources/static/points.js's `n` (how many things share this exact point).
// Optional and additive like the two slots above: a source that never calls
// this renders no extra line, so nothing changes for a source that has never
// needed one. Deliberately its OWN slot rather than a reuse of
// discoveries/markers.js's setDiscoveryPopupFacts — that one's `count` means
// "records merged into a live grid cell", a different fact from this
// catalogue's `n`, and a shared renderer cannot label both honestly from one
// string (see that module's own popupFacts doc).
let popupFacts = null;

/** Registers one read-only facts line, appended under the category line. */
export function setPopupFacts(fn) {
  popupFacts = fn;
}

/** Registers the popup action handlers: { edit, drag, askDelete }. */
export function setMarkerActions(actions) {
  markerActions = actions;
}

/**
 * Registers the dungeon map hook: { resolve(poi) -> key|null, open(key),
 * step(link) } - `step` walks a passage: see `meta.link` below.
 */
export function setDungeonLink(link) {
  dungeonLink = link;
}

/*
 * The other end of a door or a passage, or null.
 *
 * Migration 021 writes `meta.link` on BOTH ends of everything that connects two
 * maps: the 14 passages between dungeon levels, and the 12 doors, which are the
 * same relationship between the surface and level 1. One key, so one button
 * here rather than one per kind of connection.
 *
 *   { to: "<the other end's poi_id>", map: "<its map>", x, y, label }
 *
 * The coordinates are in the island canvas frame every map shares, so they are
 * usable even when the row at the far end is filtered out or absent.
 */
function linkOf(poi) {
  const link = poi.meta && poi.meta.link;
  return link && typeof link.map === "string" && link.map ? link : null;
}

/*
 * Which dungeon a pin belongs to, and how it should carry itself on the surface
 * map, from the `poi_id` migration 019 writes into meta_json.
 *
 * `dungeon.argkepher`             -> the dungeon itself: labelled like a town, so
 *                                   you can see where dungeons are without zooming
 * `dungeon.argkepher.entrance.01` -> a way in: never clustered away, but unlabelled
 *                                   (a dungeon's entrances sit within ~500 m of its
 *                                   centre and four labels there is a pile)
 * `dungeon.argkepher.boss`        -> ordinary pin; it is INSIDE, so it is only
 *                                   useful once you are in the dungeon map
 */
export function dungeonRole(meta) {
  const id = meta && typeof meta.poi_id === "string" ? meta.poi_id : "";
  if (/^dungeon\.[a-z0-9_]+$/.test(id)) return "dungeon";
  if (/^dungeon\.[a-z0-9_]+\.entrance\./.test(id)) return "entrance";
  return null;
}

/** The dungeon key of a pin that names one, or null. */
export function dungeonKeyOf(meta) {
  const id = meta && typeof meta.poi_id === "string" ? meta.poi_id : "";
  const m = /^dungeon\.([a-z0-9_]+)/.exec(id);
  return m ? m[1] : null;
}

/*
 * Builds the popup body for one pin.
 *
 * Called on OPEN, never at build time. Leaflet accepts a function as popup
 * content and invokes it each time the popup is shown, which is the same trick
 * discoveries/markers.js uses and for the same reason: the catalogue is 800+
 * pins and at most one popup is ever on screen. Building them eagerly cost 800
 * detached DOM trees, 800 SVG decodes and 2,400 listeners at boot to show one.
 */
function buildPopupNode(marker) {
  const poi = marker._poi;
  const cat = getCategory(poi.category) || { label: poi.category, icon: poi.icon };
  const typeLine = poi.type && poi.type !== poi.name
    ? escapeHtml(poi.type) + " · " + escapeHtml(cat.label || poi.category)
    : escapeHtml(cat.label || poi.category);
  const root = document.createElement("div");
  root.className = "marker-popup";
  root.innerHTML =
    "<h5>" + escapeHtml(poi.name) + "</h5>" +
    '<div class="layer"><img src="' + resolveIconSrc(poi.typeIcon, poi.icon || cat.icon) +
    '" alt="" width="14" height="14" />' + typeLine + "</div>";
  if (popupFacts) {
    const factsText = popupFacts(poi);
    if (factsText) {
      // Reuses the same muted single-line style as the category line above
      // it (and paste-location.js's own pin popup) rather than a new class —
      // one more read-only fact does not earn its own layout.
      const facts = document.createElement("div");
      facts.className = "layer";
      facts.textContent = factsText;
      root.appendChild(facts);
    }
  }

  // The way IN, and the reason the dungeon map needs no zooming to find: the pin
  // that names a dungeon is the door. First in the row, and styled primary,
  // because reading a dungeon's plan is what a player wants from that pin -
  // editing its coordinates is not.
  const dungeonKey = dungeonLink && dungeonLink.resolve(poi);
  if (dungeonKey) {
    const enter = document.createElement("button");
    enter.type = "button";
    enter.className = "primary dg-enter";
    enter.textContent = "Open dungeon map";
    enter.addEventListener("click", function () {
      map.closePopup();
      dungeonLink.open(dungeonKey);
    });
    root.appendChild(enter);
  }

  // Walking through. A passage's two ends are rows on two different maps, so
  // the far end cannot be a pin you click - it is not on screen until the page
  // has changed maps. This button is that change.
  const link = linkOf(poi);
  if (link && dungeonLink && dungeonLink.step) {
    const step = document.createElement("button");
    step.type = "button";
    step.className = "primary dg-step";
    step.textContent = "Go to " + (link.label || "the other end");
    step.addEventListener("click", function (ev) {
      // The step opens the far end's popup, and this click would otherwise
      // travel on to the map, where Leaflet's closePopupOnClick shuts it again
      // in the same gesture: the reader arrived, and nothing said so.
      L.DomEvent.stopPropagation(ev);
      map.closePopup();
      dungeonLink.step(link);
    });
    root.appendChild(step);
  }
  // No source registers any of these on the public, static build (there is
  // nothing to write to), so markerActions stays null and this popup carries
  // no authoring affordance at all — not even an inert button. A live source
  // registers all three even before its editor exists (setMarkerActions in
  // its attach()), so nothing here changes for it.
  if (markerActions) {
    const actions = document.createElement("div");
    actions.className = "popup-actions";
    if (markerActions.edit) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", function () {
        map.closePopup();
        markerActions.edit(marker);
      });
      actions.appendChild(editBtn);
    }
    if (markerActions.drag) {
      const dragBtn = document.createElement("button");
      dragBtn.type = "button";
      dragBtn.className = "drag-btn";
      dragBtn.title = "Drag to move";
      dragBtn.innerHTML = '<span class="hand" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 13v-7.5a1.5 1.5 0 0 1 3 0v6.5"/><path d="M11 5.5v-1.5a1.5 1.5 0 0 1 3 0v7.5"/><path d="M14 5.5a1.5 1.5 0 0 1 3 0v6.5"/><path d="M17 8.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1 -6 6h-2a7 6 0 0 1 -5 -2.5l-1.5 -1.5a1.5 1.5 0 0 1 2 -2.25l1.5 1.5"/><path d="M2.5 13.5l4.5 1.5"/></svg></span><span>Drag</span>';
      dragBtn.addEventListener("click", function () {
        map.closePopup();
        markerActions.drag(marker);
      });
      actions.appendChild(dragBtn);
    }
    if (markerActions.askDelete) {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", function () {
        map.closePopup();
        markerActions.askDelete(marker);
      });
      actions.appendChild(delBtn);
    }
    if (actions.childNodes.length) { root.appendChild(actions); }
  }
  return root;
}

export function bindMarkerPopup(marker) {
  marker.bindPopup(function () { return buildPopupNode(marker); });
}

export function makePoiMarker(m) {
  const cat = getCategory(m.category) || {
    id: m.category,
    label: m.category_label || m.category,
    icon: m.icon || "map-pin",
    color: m.color || "#333",
    clusterable: true
  };
  const typeIcon = m.type_icon || null;
  const displayName = m.name || m.type || cat.label;
  const typeLabel = m.type || null;
  const role = dungeonRole(m.meta);
  // A dungeon and its entrances are destinations, so they are never clustered
  // away: `landmarks` is a clusterable category and at island zoom every one of
  // them disappeared into a numbered bubble with 90 other landmarks. The dungeon
  // itself is labelled like a town; its entrances are not, because four labels
  // inside 500 m is a pile rather than a map.
  //
  // "dungeon" is a category id, not a role: snapshot v3 files the four dungeons
  // under a `dungeon` category and their twelve doors under `entrance`, so the
  // dungeons are labelled by category while the doors are only kept out of
  // clusters. `role` is the live catalogue's equivalent, derived from
  // meta.poi_id. isTownCategory() covers the two spellings of the town concept
  // itself (see its own doc, poi/state.js).
  const clusterable = !!cat.clusterable && !role;
  const labelled = isTownCategory(cat.id) || cat.id === "dungeon" || role === "dungeon";
  const priority = !clusterable;
  const marker = L.marker([m.y, m.x], {
    icon: labelled
      ? townIcon(cat.color, cat.icon, displayName, typeIcon)
      : markerIcon(cat.color, cat.icon, typeIcon),
    title: displayName,
    pane: priority ? "towns" : "markerPane",
    zIndexOffset: priority ? (role ? 1500 : 2000) : 0,
    draggable: isDragCapable()
  });
  if (marker.dragging) marker.dragging.disable();
  marker._poi = {
    id: m.id,
    // Which map this pin is on (map/active-map.js). Absent means the surface,
    // which is what every row written before maps existed is.
    map: mapOf(m),
    name: displayName,
    // The label decision, published rather than recomputed: map/poster.js draws
    // the same markers onto paper and has to give the same ones a name. It used
    // to re-derive it from `category === "towns"`, which silently stopped
    // labelling towns when v3 renamed the category to `town` and then, once
    // widened, labelled all twelve dungeon entrances as well - the exact pile of
    // overlapping text the comment above exists to prevent.
    labelled: labelled,
    rawName: m.name || null,
    category: cat.id,
    type: typeLabel,
    lat: m.y,
    lng: m.x,
    color: cat.color,
    icon: cat.icon,
    typeIcon: typeIcon,
    // Restored after it was dropped in the type-icon change: rebuild() reads it
    // to choose cluster vs priority group, and `undefined` sent all 1,064 pins
    // into the plain LayerGroup - no clustering at all, at any zoom.
    clusterable: clusterable,
    meta: m.meta || null,
    // The live catalogue derives this from `role` (meta.poi_id); snapshot v3
    // rows (sources/static/points.js) publish the key directly as `dungeon`
    // on the row instead of inventing a matching meta.poi_id — `m.dungeon`
    // wins when a row has it, so map/dungeonmode.js's resolve() (which reads
    // exactly this field) still finds the door on a v3 "dungeon" pin.
    dungeon: m.dungeon || (role ? dungeonKeyOf(m.meta) : null),
    note: m.note || null,
    disposition: m.disposition || null
  };
  bindMarkerPopup(marker);
  return marker;
}

/** Builds the initial pin set from a /map-data markers payload. */
export function buildMarkers(markers) {
  (markers || []).forEach(function (m) {
    addMarker(makePoiMarker(m));
  });
}

/*
 * The MAP first, then category and type toggles, THEN the global query.
 *
 * The map is not a filter the reader operates - it is where they are standing.
 * A dungeon level shares its canvas coordinates with the surface directly above
 * it, so nothing about a pin's position can tell the two apart; only its map
 * can. Everything after that is an ordinary filter: a pin hidden by its own
 * category must stay hidden no matter what is typed, and a pin the filters admit
 * is still subject to the query narrowing the map along with every registered
 * source's own list.
 */
export function markerVisible(poi) {
  if (!onActiveMap(poi)) return false;
  if (!isCatEnabled(poi.category)) return false;
  if (poi.type) {
    const te = getTypeEnabled(poi.category);
    if (te && Object.keys(te).length !== 0 && poi.type in te && !te[poi.type]) return false;
  }
  return matches(poi.name + " " + (poi.type || "") + " " + poi.category);
}

export function visibleCountFor(categoryId, typeLabel) {
  let n = 0;
  getMarkers().forEach(function (mk) {
    const poi = mk._poi;
    if (poi.category !== categoryId) return;
    if (typeLabel && poi.type !== typeLabel) return;
    if (markerVisible(poi)) n++;
  });
  return n;
}

/*
 * How many pins of a category are on the map currently shown, before any
 * toggle or query - "does this category exist here at all", not "how many can
 * you see".
 *
 * visibleCountFor cannot answer that: it runs the full markerVisible gate, so
 * a caller using it to decide whether a category is PRESENT would delete the
 * row the moment the reader switched that category off, and again the moment
 * they typed a query that missed it. The distinction only started mattering
 * with snapshot v3, which is the first data to put a category entirely on one
 * map - the four dungeons' ways out, journals, levers and loot exist only
 * inside, so on the surface they are not "all filtered out", they are not
 * there.
 */
export function presentCountFor(categoryId) {
  let n = 0;
  getMarkers().forEach(function (mk) {
    const poi = mk._poi;
    if (poi.category === categoryId && onActiveMap(poi)) { n++; }
  });
  return n;
}

/*
 * Re-derives both layer groups from the filter state.
 *
 * TWO things make this cheap, and both were measured against the live
 * catalogue (808 pins) before and after:
 *
 * 1. COALESCED. One user gesture calls this many times — view/filters.js
 *    `toggleGroup` flips a category and then every type under it, and
 *    `showAll` does that for all 14 categories — and each call used to clear
 *    and refill the whole cluster tree. Show all measured 1.9 s of frozen main
 *    thread, a single category toggle 254 ms. See map/marker-layer.js.
 * 2. BULK addLayers, not addLayer per marker. markercluster splices the tree
 *    per call on the single-layer path and builds it once on the bulk path —
 *    the discovery layer already did this and toggled 20x faster for it.
 *    priorityGroup is a plain LayerGroup with no such path (and holds 9 towns).
 */
const rebuild = coalesced(function () {
  // A rebuild empties both groups, and Leaflet closes a marker's popup the
  // moment the marker leaves the map - so any rebuild used to shut a popup the
  // reader was reading: a category toggle, a store refresh, or arriving through
  // a passage, where the popup that says where you came out was opened and then
  // swept away by the rebuild the same map change scheduled. Reopened below if
  // the pin survives the new filter state.
  const open = getMarkers().find(function (mk) { return mk.isPopupOpen(); });
  clusterGroup.clearLayers();
  priorityGroup.clearLayers();
  const clustered = [];
  getMarkers().forEach(function (mk) {
    if (!markerVisible(mk._poi)) return;
    if (mk._poi.clusterable) clustered.push(mk);
    else priorityGroup.addLayer(mk);
  });
  if (clustered.length) clusterGroup.addLayers(clustered);
  if (open && open._map) { open.openPopup(); }
});

export const rebuildLayers = rebuild.schedule;

/**
 * Runs a pending rebuild now, for the few callers that READ the layer groups
 * straight after asking for one — `reveal` asks clusterGroup whether it holds
 * a marker before it zooms to it, and a stale answer sends the map elsewhere.
 */
export const flushLayerRebuild = rebuild.flush;

export function removeMarkerFromMap(marker) {
  try { clusterGroup.removeLayer(marker); } catch { /* already detached */ }
  try { priorityGroup.removeLayer(marker); } catch { /* already detached */ }
  removeMarker(marker);
}

// Entering or leaving a dungeon does not filter the catalogue, it changes which
// map's records are on screen - but the work is identical to a category toggle,
// so it goes through the same coalesced rebuild rather than a second path that
// could disagree with it.
onMapChange(rebuildLayers);
