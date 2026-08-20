/*
 * Everything about the discovery catalogue that is presentation, not transport:
 * the store mirror, the list/editor descriptor pieces (title, groups, sorts,
 * fields…) and reveal-on-the-map. Both the private repo's own live
 * discoveries source (the live source, DELETE-capable) and this
 * package's sources/static/discoveries.js (the read-only public build) build
 * their descriptor by spreading `presentation` over their own
 * id/can/attach/load/save/create/remove — the two things that actually differ
 * between "rows arrive from a poll" and "rows arrive once from a committed
 * snapshot".
 *
 * Nothing here imports discoveries/api.js or discoveries/sync.js: every
 * function operates on rows already in discoveries/state.js, however they got
 * there, which is what lets the static build import this module with zero
 * network code in its bundle.
 */
import { map } from "../map/instance.js";
import { worldToMap } from "../map/projection.js";
import { subscribe as subscribeQuery } from "../map/query.js";
import {
  KINDS, allRows, discoveryCluster, discoveryVisible, isKindEnabled, kindCounts,
  kindMeta, notify, setKindEnabled, subscribe
} from "./state.js";
import {
  clearDiscoveryIsolation, isolateDiscovery, rebuildDiscoveryLayer
} from "./markers.js";
import { rebuildLayers } from "../poi/markers.js";
import { GROUPS, ROWS } from "../registry/store.js";

let store = null;

export function attachStore(next) {
  store = next;
}

/*
 * The rows live in discoveries/state.js — a poll or a one-shot snapshot load
 * writes them there and the markers read them from there — so this mirrors
 * them into the store on every change rather than keeping a second catalogue.
 * adoptRows takes the very same objects, so nothing is copied per row; a delta
 * of 3 rows out of 10^5 still costs one pass over the keys, which is what the
 * store's coalescing is for.
 */
export function mirror() {
  store.adoptRows(allRows());
}

/**
 * Wires the two change channels every discoveries descriptor needs: a row
 * change (poll delta, or the one-shot snapshot apply) mirrors into the store,
 * and the global query narrows this layer too (discoveries/state.js
 * discoveryVisible), so a keystroke rebuilds the cluster the same way a kind
 * toggle does — coalesced, so a burst of keystrokes collapses.
 */
export function wireNotifications() {
  subscribe(function () {
    mirror();
    store.notify(ROWS, GROUPS);
  });
  subscribeQuery(function () {
    rebuildDiscoveryLayer();
    store.notify(ROWS, GROUPS);
  });
}

/*
 * Squared distance — the square root would be a per-comparison call that cannot
 * change any ordering. With no origin every row is equally far away, which has to
 * be returned as 0 rather than Infinity: Infinity - Infinity is NaN, and a
 * comparator that returns NaN sorts in an implementation-defined order.
 */
function sqDistance(origin, row) {
  if (!origin) { return 0; }
  const dx = row.x - origin.x;
  const dy = row.y - origin.y;
  return dx * dx + dy * dy;
}

function byLabel(a, b) {
  const al = a.label.toLowerCase();
  const bl = b.label.toLowerCase();
  if (al === bl) { return 0; }
  return al < bl ? -1 : 1;
}

/*
 * The fields any discovery row has, whoever supplied it. A source that knows
 * more about its rows than this - the live one, which also holds sighting
 * counts, timestamps and a class name - appends its own entries; the words
 * for those belong with the data, not in a build that never receives it.
 *
 * Class is deliberately NOT here: a published static row is named, not
 * classed (the exporter folds the class into `label`), so this build never
 * has one to show. The live source registers its own "Class" field the same
 * way it registers Observations / First seen / Last seen below.
 *
 * `count` is deliberately labelled plainly: to a published snapshot row it is
 * how many things are at that spot, and only the live source can call it a
 * simultaneous sighting.
 */
const fields = [
  { key: "kind", label: "Kind", type: "readonly", value: function (row) { return kindMeta(row.kind).label; } },
  { key: "count", label: "Count", type: "readonly", value: function (row) { return String(row.count); } },
  { key: "coords", label: "Position", type: "coords" }
];

/** The descriptor members every discoveries source shares, regardless of `can`. */
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

  /** `Cepa ×12` — the count only earns space in the title when it is news. */
  title: function (row) {
    return row.count > 1 ? row.label + " \u00d7" + row.count : row.label;
  },

  subtitle: function (row) {
    return kindMeta(row.kind).label;
  },

  iconName: function (row) {
    return kindMeta(row.kind).icon;
  },

  accent: function (row) {
    return kindMeta(row.kind).color;
  },

  latLng: function (row) {
    // UE world metres in, canvas out, through the one projection path.
    return worldToMap(row.x, row.y);
  },

  searchText: function (row) {
    // A published row has no className (empty string): joining it in as-is
    // is harmless today (normalize() never leaves it undefined), but the
    // haystack should only ever carry words that actually describe the row.
    const bits = row.className ? [row.label, row.className, row.kind] : [row.label, row.kind];
    return bits.join(" ").toLowerCase();
  },

  /*
   * The kinds PRESENT, in DiscoveryKind enum order (KINDS), with every count
   * taken in ONE pass over the catalogue — six separate scans of 10^5 rows to
   * draw six small integers is what kindCounts exists to avoid.
   *
   * A kind with no rows is omitted rather than listed as 0. A toggle that can
   * only ever hide nothing is noise, and on a catalogue that deliberately
   * excludes a kind it is worse than noise: it advertises the gap. The count is
   * over the whole catalogue, not the filtered view, so disabling a kind never
   * makes its own toggle disappear.
   */
  groups: function () {
    const counts = kindCounts();
    const out = [];
    for (const k of KINDS) {
      const count = counts.byKind[k.slug] || 0;
      if (!count) { continue; }
      out.push({ id: k.slug, label: k.label, color: k.color, icon: k.icon, count: count });
    }
    return out;
  },

  groupOf: function (row) {
    return row.kind;
  },

  /**
   * Whether `row` earns a marker right now — kind toggle, active map and the
   * global query, the exact gate markers.js applies when it rebuilds the
   * cluster. Shared rather than re-derived so the search summary (view/search.js)
   * can never report a match the map itself does not draw.
   */
  visible: discoveryVisible,

  /*
   * The kind toggles stay in discoveries/state.js, which owns and persists them
   * under its own localStorage key: the markers read them directly when they
   * rebuild, and a second copy in the store would be a second truth with no
   * conflict story.
   */
  isGroupEnabled: function (groupId) {
    return isKindEnabled(groupId);
  },

  setGroupEnabled: function (groupId, on) {
    setKindEnabled(groupId, on);
    rebuildDiscoveryLayer();
    rebuildLayers();
    notify();
  },

  layerOn: function () {
    return store.getView().layerOn;
  },

  /*
   * The whole cluster group leaves the map. Unlike the bookmark layer there is no
   * per-row visibility pass to lean on, and unlike the pin catalogue there is
   * only one group — these rows are deliberately kept out of the curated one
   * (see discoveries/state.js) so they can be hidden without hiding anything a
   * person placed.
   */
  setLayerOn: function (on) {
    store.setLayerOn(on);
    if (on) {
      discoveryCluster.addTo(map);
      rebuildDiscoveryLayer();
    } else {
      // An isolated pin is a direct map layer, so removing the group does not
      // reach it — hiding the layer would leave exactly one discovery on screen.
      clearDiscoveryIsolation();
      map.removeLayer(discoveryCluster);
    }
  },

  sorts: [
    { value: "name", label: "Name", compare: byLabel },
    {
      value: "kind",
      label: "Kind",
      compare: function (a, b) {
        if (a.kind !== b.kind) { return a.kind < b.kind ? -1 : 1; }
        return byLabel(a, b);
      }
    },
    {
      value: "count",
      label: "Most seen",
      compare: function (a, b) {
        const d = b.count - a.count;
        return d !== 0 ? d : byLabel(a, b);
      }
    },
    {
      value: "distance",
      label: "Nearest to you",
      compare: function (a, b, ctx) {
        const origin = ctx && ctx.youWorld;
        return sqDistance(origin, a) - sqDistance(origin, b);
      }
    }
  ],

  fields: fields,

  toForm: function (row) {
    // Every field is readonly and the editor resolves `value(row)` itself, so the
    // only entry that has to be here is the one the coords renderer reads.
    return { coords: { x: row.x, y: row.y } };
  },

  /**
   * Fly to one row AND draw it as its own pin.
   *
   * The isolation is the point. These pins cluster at every zoom, so before
   * this the honest thing a reveal could do was centre the map on a bubble
   * labelled with a number — the user had already told us exactly which row
   * they wanted and the map answered with a crowd. `isolateDiscovery` lifts
   * that one marker out of the cluster group (see markers.js); the popup then
   * opens, which is only worth doing because there is now a single pin under
   * the cursor to open it on.
   *
   * The spotlight ends by itself: another reveal replaces it, a filter that
   * hides the row drops it, and deleting the row or turning the layer off
   * takes it away.
   */
  reveal: function (id) {
    const row = store.getRow(id);
    if (!row) { return; }
    store.setView({ activeId: id, anchorId: id });
    const at = worldToMap(row.x, row.y);
    if (!at) { return; }
    map.setView([at.lat, at.lng], Math.max(map.getZoom(), 1));
    const marker = isolateDiscovery(id);
    if (marker) { marker.openPopup(); }
  }
};
