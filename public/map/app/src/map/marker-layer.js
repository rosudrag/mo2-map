/*
 * The four things all three marker layers do the same way.
 *
 * WHY THIS IS NOT A GENERIC RENDERER. The obvious consolidation — one engine
 * that draws every marker system from a descriptor, the way the registry
 * layer draws every source's row list from one — was tried on paper and
 * rejected. The three
 * layers differ exactly where it would have to be configurable: the pin
 * catalogue holds pre-built markers in an array across TWO groups (clustered
 * pins, unclustered towns) and rebuilds wholesale; bookmarks mutate ONE marker
 * at a time and carry drag, hover and selection state that must survive a
 * delta; discoveries are bulk-applied from a cursor and never move. An engine
 * covering all three needs an option for each of those differences, which is
 * the same code with a worse name and a shared blast radius.
 *
 * What DOES duplicate is the plumbing underneath, and it duplicated verbatim:
 * pane creation, the cluster group's option block and its click behaviour, the
 * coalesced rebuild, and the delegated popup-button listener. Those are here.
 * Each layer keeps its own rendering strategy and stops re-implementing the
 * bits that were never really its own.
 *
 * The test for whether something belongs in this file: would a fix to it
 * otherwise have to be written two or three times? Clustering options and the
 * rebuild scheduler answered yes — both were, and one of them was the page's
 * worst measured stall.
 */
import { map } from "./instance.js";
import { img } from "./meta.js";

/**
 * A pane at a fixed z-index, created on demand and only once.
 *
 * The stacking order of the marker systems is declared where each layer is
 * built rather than being implied by main.js's import order — which is how it
 * used to work: the "clusters" and "towns" panes were created as a side effect
 * of importing map/paste-location.js, and the pin catalogue's cluster group
 * named a pane it was merely lucky to find already there.
 *
 * The order that matters and why: discoveries (590) sit BELOW the curated pin
 * panes because a machine-scraped guess must never occlude a pin a person
 * placed; towns (680) sit above everything because a place name is the map's
 * primary navigation.
 *
 * @param {string} name
 * @param {number} zIndex
 * @param {string} [className] extra class on the pane element
 */
export function createMarkerPane(name, zIndex, className) {
  if (!map.getPane(name)) {
    map.createPane(name);
    map.getPane(name).style.zIndex = zIndex;
    if (className) { map.getPane(name).classList.add(className); }
  }
  return name;
}

/**
 * A marker cluster group with the options every clustered layer on this page
 * wants, plus the two that differ.
 *
 * @param {Object}   opts
 * @param {string}   opts.pane          pane for the cluster bubbles
 * @param {number}   opts.radius        maxClusterRadius in pixels
 * @param {boolean} [opts.clusterAtMaxZoom]  true  → bubble at every zoom and
 *   spiderfy to take a bubble apart; false → stop clustering at max zoom so
 *   pins sit on their real coordinates. The pin catalogue wants false (a
 *   hand-placed pin's exact spot is the point); discoveries want true (one camp
 *   is legitimately several rows a few metres apart, which unclustered draws as
 *   a smear).
 * @param {Function} [opts.iconCreateFunction]  Leaflet default when omitted.
 */
export function createClusterGroup(opts) {
  const atMaxZoom = opts.clusterAtMaxZoom === true;
  const options = {
    showCoverageOnHover: false,
    maxClusterRadius: opts.radius,
    /*
     * chunkedLoading spreads a bulk addLayers across several frames instead of
     * building the whole cluster tree in one task. It is what keeps a zoom
     * change and a filter toggle off the "long task" list once a layer holds
     * thousands of markers — measured on the discovery layer at 1,562 rows.
     */
    chunkedLoading: true,
    chunkInterval: 50,
    chunkDelay: 10,
    // Never zoom on a bubble click: both layers fly to the child bounds
    // instead, which keeps the animation and the destination under our control.
    zoomToBoundsOnClick: false,
    spiderfyOnMaxZoom: false,
    animate: true,
    clusterPane: opts.pane
  };
  if (!atMaxZoom) { options.disableClusteringAtZoom = img.maxZoom; }
  if (opts.iconCreateFunction) { options.iconCreateFunction = opts.iconCreateFunction; }

  const group = L.markerClusterGroup(options);

  /*
   * Click a bubble → fly into its child bounds; at max zoom, fan the children
   * out instead, because there is nowhere left to fly.
   *
   * The fan-out is called explicitly rather than left to `spiderfyOnMaxZoom`.
   * That option only fires when the plugin's own `cluster._zoom` equals the
   * group's computed `_maxZoom`, and on this map — CRS.Simple, maxZoom 4, an
   * image overlay rather than tiles — that equality does not hold for every
   * bubble that survives to max zoom, so clicking one did nothing at all. A
   * group you cannot open is worse than no grouping, and this is one call.
   */
  group.on("clusterclick", function (e) {
    const cluster = e.layer;
    L.DomEvent.stopPropagation(e);
    if (atMaxZoom && map.getZoom() >= img.maxZoom) {
      cluster.spiderfy();
      return;
    }
    const childBounds = cluster.getBounds();
    if (!childBounds.isValid()) { return; }
    map.flyToBounds(childBounds.pad(0.45), {
      maxZoom: img.maxZoom,
      duration: 0.85,
      easeLinearity: 0.2
    });
  });

  return group;
}

/**
 * Wraps a full-layer rebuild so that N calls in one turn are ONE rebuild.
 *
 * This is the fix for the page's worst measured stall. A single gesture in the
 * filter panel calls a layer's rebuild once per group — `showAll` did it 20
 * times across the two clustered layers — and each call cleared and refilled
 * the whole cluster tree: 222 clearLayers and 113,376 internal addLayer calls
 * for one click, 1.9 s of frozen main thread. A rebuild derives everything from
 * state and is therefore idempotent, so collapsing the burst is free.
 *
 * A microtask, not a timer: the DOM must be right before the browser paints or
 * hands control back to the user.
 *
 * @param {() => void} rebuild
 * @returns {{schedule: () => void, flush: () => void}} `flush` runs a pending
 *   rebuild NOW, for the few callers that read the layer back straight after
 *   asking for one — `reveal` asks the cluster group whether it holds a marker
 *   before zooming to it, and a stale answer there sends the map elsewhere.
 */
export function coalesced(rebuild) {
  let scheduled = false;
  function run() {
    scheduled = false;
    rebuild();
  }
  return {
    schedule: function () {
      if (scheduled) { return; }
      scheduled = true;
      Promise.resolve().then(run);
    },
    flush: function () {
      if (scheduled) { run(); }
    }
  };
}

/**
 * Routes clicks on popup buttons carrying `data-<ns>-pop` to named handlers.
 *
 * ONE listener on the map container per namespace, because Leaflet throws the
 * popup DOM away and rebuilds it on every open — so a listener attached to the
 * buttons themselves leaks one per render. The id travels on the button as
 * `data-<ns>-id`.
 *
 * Returns a setter rather than taking the handlers directly: the marker module
 * is imported by the source adapter that owns the commands, so the wiring has
 * to point one way and be filled in afterwards.
 *
 * @param {string} ns short namespace, e.g. "bm" or "disco"
 * @returns {(handlers: Record<string, (id: string) => void>) => void}
 */
export function delegatePopupActions(ns) {
  let handlers = {};
  map.getContainer().addEventListener("click", function (e) {
    const btn = e.target.closest("[data-" + ns + "-pop]");
    if (!btn) { return; }
    const id = btn.getAttribute("data-" + ns + "-id");
    const run = handlers[btn.getAttribute("data-" + ns + "-pop")];
    if (!run || !id) { return; }
    map.closePopup();
    run(id);
  });
  return function (next) { handlers = next || {}; };
}
