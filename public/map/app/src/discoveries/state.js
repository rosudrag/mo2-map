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

/**
 * `#rrggbb` -> `rgba(r,g,b,a)`. No CSS `color-mix()` here: the build targets
 * chrome70 (main-static.js's own header, bin/build.mjs's ESBUILD_TARGET) for
 * the embedded browsers this map is also viewed through, and color-mix landed
 * in 2023. Doing the blend in JS keeps the bubble tintable at build time
 * without needing a CSS feature that old engine does not have.
 */
function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
}

/** `1193` -> `"1.2k"`. A four-digit count in a 26px circle is not legible; a
 * rounded-to-one-decimal abbreviation still answers "roughly how much". */
function shortCount(n) {
  if (n < 1000) { return String(n); }
  const k = (n / 1000).toFixed(1).replace(/\.0$/, "");
  return k + "k";
}

/*
 * The bubble counts ENTITIES, not rows, and is now tinted by whichever kind
 * contributes the most of them — a reader scanning the island should see
 * "green over there" (resources) or "red-brown there" (spawns) before they
 * ever read a number, the same way a curated pin's colour already works.
 * Leaflet's default is the child-marker count, which would put "2" on a
 * bubble holding `Akrep ×3` and `Gamal ×1` — a number that matches nothing
 * the user can see and sits in a circle that looks just like the pin's own
 * ×N badge. Summing the counts answers the question actually being asked of
 * a camp: how much is in there.
 *
 * The count sits in its own small opaque pill (`.cluster-count`,
 * discoveries.css), independent of the kind-tinted ring behind it. Measured
 * why this has to be two layers, not one: at the ring's shipped alpha (.58)
 * over the palest realistic terrain, EVERY kind colour read under 2:1
 * against the numeral text — and raising the ring to fully OPAQUE does not
 * save it either (measured 3.0–4.4:1 for every kind, none reaching the 4.5:1
 * AA floor), because the kind palette itself is too close in lightness to
 * the numeral. A translucent ring can carry the "what kind" signal or
 * guarantee the "how many" text stays legible, never both at once — so this
 * gives each job its own layer: the ring stays exactly as light as the
 * density fix needs, and the pill is opaque enough (measured 10.8–15.7:1
 * across every kind and both a white and a black worst-case backdrop —
 * discoveries.css carries the full table) that the number reads regardless
 * of kind colour or what terrain is under the bubble.
 *
 * `iconSize` is 46, not the ring's own 38: the ring needs a 4 px margin
 * inside the icon box on every side (discoveries.css), and that box is set
 * HERE, not in CSS — Leaflet reads `iconSize` to place the marker, size its
 * hit area, and compute cluster radii, so a CSS-only ring resize would
 * either get silently clipped to the old 34 px box or overflow it with a
 * hit area that no longer matches what is drawn. 38 px was sized to the
 * count pill's own worst case (an unabbreviated "999", the largest
 * `shortCount` will render as digits rather than "1.0k"): measured at
 * 22 x 17 px, which needs a 19 px ring radius to keep the ring visible past
 * the pill's corner — the OLD 13 px radius (26 px ring) was already smaller
 * than that corner distance, which is why a three-digit bubble measured as
 * reading almost entirely black instead of kind-tinted.
 */
function clusterIcon(cluster) {
  let total = 0;
  const byKind = Object.create(null);
  const children = cluster.getAllChildMarkers();
  for (let i = 0; i < children.length; i++) {
    const row = children[i]._discovery;
    const n = row && row.count > 0 ? row.count : 1;
    total += n;
    if (row) { byKind[row.kind] = (byKind[row.kind] || 0) + n; }
  }
  let dominant = null, dominantN = -1;
  for (const slug of Object.keys(byKind)) {
    if (byKind[slug] > dominantN) { dominant = slug; dominantN = byKind[slug]; }
  }
  const color = kindMeta(dominant).color;
  const size = total < 10 ? "small" : total < 100 ? "medium" : "large";
  return L.divIcon({
    // !important on the inline style, not just the value: filter-panel.css's
    // OWN cluster default (the curated pin catalogue's) is a global
    // `!important` rule with no pane scope, and an important stylesheet
    // declaration beats a plain inline style regardless of specificity — only
    // an important INLINE declaration outranks it.
    html: '<div style="background-color:' + withAlpha(color, .58) +
      " !important;border-color:" + withAlpha(color, .9) +
      ' !important"><span class="cluster-count">' + shortCount(total) + "</span></div>",
    className: "marker-cluster marker-cluster-" + size,
    iconSize: L.point(46, 46)
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
 * holds several rows because the exporter's merge key is (kind, folded
 * species/class, grid cell), not "everything nearby is the same thing" - two
 * different creatures recorded at the exact same spot ("Sarducaa Bandit A"
 * and "Sarducaa Bandit Ranged A") are two correct rows, and even the same
 * species can straddle a grid-cell boundary and publish as two rows a few
 * metres apart ("Hunter Lizard" 2 m from "Hunter Lizard"). Unclustering at
 * max zoom draws rows like these smeared on top of each other, which reads
 * as "grouping is broken" when the grouping is in fact right. Bubbling them
 * is the honest picture; spiderfy is how you take them apart, and
 * map/marker-layer.js calls it explicitly.
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
 * The layer used to need only counts, because a discovery had no row list of
 * its own to be searched or sorted in. discoveries/view.js mirrors these into
 * a registry store so the rows can be listed, searched and sorted like any
 * other registered source's.
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
