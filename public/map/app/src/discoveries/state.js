/*
 * Shared state for the auto-discovery layer: the row catalogue, the delta
 * cursor, the per-kind filter toggles and the Leaflet cluster group the
 * discovery pins live in.
 *
 * This module is the bottom of the discoveries/ stack — markers.js and
 * filter-section.js import it and it imports nothing from discoveries/. Same
 * shape and same reason as poi/state.js: state flows down, and the one call
 * that has to go back up (a render after a delta) is an explicit subscription
 * rather than this module knowing who draws what.
 */
import { map } from "../map/instance.js";
import { createClusterGroup, createMarkerPane } from "../map/marker-layer.js";
import { matches } from "../map/query.js";
import { activeMapId, mapOf } from "../map/active-map.js";
import { currentMapId } from "../map/current.js";

// Kind slugs are lowercase on the wire, in the DB and in these filter ids — see
// docs/mo2-auto-discovery-mapping-task.md §5.5. Listed in DiscoveryKind enum
// order so the filter section reads top-to-bottom like the C# rule table.
//
// `icon` may only name an SVG committed under assets/tabler/: a missing file
// 404s silently and only a human looking at the map notices. The vendored set
// is closed and small, so these are the nearest available glyph rather than the
// obvious name (see ui/icons.js for the full argument).
export const KINDS = [
  { slug: "resource", label: "Resources", icon: "diamond", color: "#5f8f6a" },
  { slug: "container", label: "Containers", icon: "box", color: "#a8823f" },
  { slug: "station", label: "Stations", icon: "swords", color: "#7d7f9a" },
  { slug: "npc", label: "NPCs", icon: "user", color: "#6f8ba8" },
  { slug: "structure", label: "Structures", icon: "building-community", color: "#8a7a63" },
  { slug: "spawn", label: "Spawns", icon: "paw", color: "#a05a4a" }
];

const KIND_BY_SLUG = Object.create(null);
for (const k of KINDS) { KIND_BY_SLUG[k.slug] = k; }

// Its own key, not shared with mo2map.<mapId>.bm-prefs: the two panels have
// separate lifetimes and a corrupt blob in one must not take the other's
// prefs down. Per-map: computed once at import time, same as active-map.js's
// SURFACE_MAP.
const PREFS_ITEM = "mo2map." + currentMapId() + ".discovery-prefs";

const rows = Object.create(null);
const kindEnabled = Object.create(null);
let serverSeq = 0;
let pollOk = true;

/*
 * The bubble counts ENTITIES, not rows.
 *
 * Leaflet's default is the child-marker count, which would put "2" on a bubble
 * holding `Akrep ×3` and `Gamal ×1` — a number that matches nothing the user
 * can see and sits in a circle that looks just like the pin's own ×N badge.
 * Summing the counts answers the question actually being asked of a camp:
 * how much is in there.
 */
function clusterIcon(cluster) {
  let total = 0;
  const children = cluster.getAllChildMarkers();
  for (let i = 0; i < children.length; i++) {
    const row = children[i]._discovery;
    total += row && row.count > 0 ? row.count : 1;
  }
  const size = total < 10 ? "small" : total < 100 ? "medium" : "large";
  return L.divIcon({
    html: "<div><span>" + total + "</span></div>",
    className: "marker-cluster marker-cluster-" + size,
    iconSize: L.point(40, 40)
  });
}

// The discovery pins sit BELOW the curated pin panes (markerPane 600, clusters
// 650, presence 670, towns 680). A machine-scraped guess must never occlude a
// pin a person placed by hand.
createMarkerPane("discoveries", 590);

/*
 * Its OWN cluster group, deliberately not poi/state.js's. Auto-scraped rows
 * must not be mixed into the group that holds community-verified furniture:
 * a shared group would put a machine-observed sighting inside the same
 * "12 markers" bubble as twelve curated pins and there would be no way to tell
 * the two apart, or to hide one without hiding the other.
 *
 * 80 px against the catalogue's 110 px — discovery rows are far denser (one per
 * node, not one per landmark), so a wide radius would collapse a whole forest
 * of iron into a single unhelpful bubble.
 *
 * clusterAtMaxZoom, unlike the curated catalogue: a single camp legitimately
 * holds several rows because `class_name` is part of the merge key, so
 * "Nightsnatcher" and "Nightsnatcher Baby" 9 m apart are two correct rows — and
 * 9 m is 30 px even at max zoom. Unclustering there drew them smeared on top of
 * each other, which reads as "grouping is broken" when the grouping is in fact
 * right. Bubbling them is the honest picture; spiderfy is how you take them
 * apart, and map/marker-layer.js calls it explicitly.
 */
export const discoveryCluster = createClusterGroup({
  pane: "discoveries",
  radius: 80,
  clusterAtMaxZoom: true,
  iconCreateFunction: clusterIcon
}).addTo(map);

// ---- change notification -------------------------------------------------
// One channel and no coalescing microtask, unlike bookmarks/store.js: the only
// writer is the poll, which applies a whole payload and then notifies ONCE. A
// 5000-row delta must not re-render the filter counts 5000 times.
const subscribers = [];

export function subscribe(fn) {
  subscribers.push(fn);
}

export function notify() {
  for (const fn of subscribers) { fn(); }
}

// ---- kind catalogue ------------------------------------------------------

/** The presentation entry for a slug, or a grey stand-in for one we do not know. */
export function kindMeta(slug) {
  return KIND_BY_SLUG[slug] || { slug: slug, label: slug, icon: "map-pin", color: "#6b6257" };
}

// ---- rows ----------------------------------------------------------------

/**
 * Coerces one wire row into the shape the rest of the layer assumes.
 *
 * Number(null) and Number("") are both 0, so an absent count would silently
 * become a real 0 and render as "×0" — only genuine numbers pass, and a row
 * without a count is one thing seen once. x/y stay raw UE world METRES;
 * nothing here converts to canvas pixels (that is worldToMap's job, once).
 *
 * `seq` and `z` are dropped rather than carried: the cursor is the payload's
 * server_seq, not any row's, nothing renders elevation, and the catalogue can
 * reach 10^5 rows — an unused field per row is a real cost for a decoration.
 */
function normalize(raw) {
  const count = Number(raw.count);
  const observations = Number(raw.observations);
  return {
    id: String(raw.id),
    kind: String(raw.kind || ""),
    className: raw.class_name ? String(raw.class_name) : "",
    label: raw.label ? String(raw.label) : (raw.class_name ? String(raw.class_name) : "Unknown"),
    x: Number(raw.x),
    y: Number(raw.y),
    count: Number.isFinite(count) && count > 0 ? count : 1,
    observations: Number.isFinite(observations) && observations > 0 ? observations : 0,
    // A discovery from a server that predates the maps column never had this
    // field; mapOf() treats that absence as the surface, matching the DB
    // column's own default so old rows keep showing up where they always did.
    map: mapOf(raw),
    firstSeenAt: raw.first_seen_at || null,
    lastSeenAt: raw.last_seen_at || null
  };
}

/** Adopts one wire row, replacing any earlier revision of it. Returns the row. */
export function putRow(raw) {
  const row = normalize(raw);
  rows[row.id] = row;
  return row;
}

export function dropRow(id) {
  delete rows[id];
}

/**
 * Every row currently known, in insertion order.
 *
 * The layer used to need only counts, because a discovery had no manager and no
 * list. manage/sources/discoveries.js mirrors these into its store so the rows
 * can be listed, searched and sorted like any other source's.
 */
export function allRows() {
  return Object.keys(rows).map(function (id) { return rows[id]; });
}

/**
 * Re-inserts an ALREADY-NORMALIZED row.
 *
 * Deliberately separate from putRow: this is the rollback path for a delete the
 * server refused, and the row being put back came from a store snapshot rather
 * than off the wire. Feeding it through normalize() would read `class_name` and
 * `first_seen_at` off an object that carries `className` and `firstSeenAt`, and
 * quietly blank both.
 */
export function restoreRow(row) {
  rows[row.id] = row;
}

/**
 * Every number the filter section needs, in ONE pass: { total, byKind }.
 *
 * Six separate scans of a catalogue that can hold 10^5 rows, once per render,
 * is 600k comparisons to draw six small integers. The section always wants all
 * of them at once, so it asks once.
 */
export function kindCounts() {
  const byKind = Object.create(null);
  for (const k of KINDS) { byKind[k.slug] = 0; }
  const ids = Object.keys(rows);
  for (const id of ids) {
    const kind = rows[id].kind;
    if (kind in byKind) { byKind[kind]++; }
  }
  return { total: ids.length, byKind: byKind };
}

// ---- delta cursor --------------------------------------------------------

export function getServerSeq() {
  return serverSeq;
}

/** Monotonic: a payload that somehow reports an older seq must not rewind us. */
export function setServerSeq(seq) {
  if (Number.isFinite(seq) && seq > serverSeq) { serverSeq = seq; }
}

export function isPollOk() {
  return pollOk;
}

export function setPollOk(ok) {
  pollOk = !!ok;
}

// ---- filter state --------------------------------------------------------

export function isKindEnabled(slug) {
  return kindEnabled[slug] !== false;
}

export function setKindEnabled(slug, on) {
  kindEnabled[slug] = !!on;
  savePrefs();
}

/**
 * Whether a discovery row earns a marker right now: the kind toggle first,
 * then the global query (map/query.js) — a row hidden by its own kind toggle
 * stays hidden regardless of what is typed, same order poi/markers.js
 * markerVisible uses.
 */
export function discoveryVisible(row) {
  if (!row) { return false; }
  // A dungeon level is drawn on the same canvas coordinates as the surface
  // above it, so a discovery's (x, y) alone cannot tell which one it belongs
  // to — the map id is the only thing that can, and it must gate the row
  // before the kind/query filters below ever run.
  if (row.map !== activeMapId()) { return false; }
  if (!isKindEnabled(row.kind)) { return false; }
  return matches(row.label + " " + row.className + " " + row.kind);
}

/*
 * Every kind starts visible, including `npc`. Whether npc rows are ever
 * recorded is an upstream data decision (it defaults off, "ignore towns");
 * once such a row exists here, hiding it by default would make someone's
 * own data invisible to them.
 */
for (const k of KINDS) { kindEnabled[k.slug] = true; }

function loadPrefs() {
  let saved = null;
  try {
    const raw = window.localStorage.getItem(PREFS_ITEM);
    saved = raw ? JSON.parse(raw) : null;
  } catch { saved = null; }
  if (!saved || typeof saved !== "object" || !saved.kindEnabled) { return; }
  // Only slugs we know: a stale pref naming a retired kind must not resurrect it
  // as an unfilterable ghost entry, and only view state is ever restored — the
  // rows themselves are server-owned and arrive through the cursor.
  for (const k of KINDS) {
    if (typeof saved.kindEnabled[k.slug] === "boolean") {
      kindEnabled[k.slug] = saved.kindEnabled[k.slug];
    }
  }
}

function savePrefs() {
  const out = { kindEnabled: {} };
  for (const k of KINDS) { out.kindEnabled[k.slug] = kindEnabled[k.slug] !== false; }
  try { window.localStorage.setItem(PREFS_ITEM, JSON.stringify(out)); } catch { /* private mode */ }
}

loadPrefs();
