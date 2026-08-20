/*
 * The one filter box: #search, and the joined feedback bar (#search-summary)
 * that replaced the old pick-a-suggestion dropdown this bar's element used
 * to hold.
 *
 * The old box (poi/search.js, deleted) made you PICK a suggestion before it
 * would isolate anything, and isolating meant hiding the other two catalogues
 * behind an empty Set. This box does the opposite: every keystroke narrows the
 * map and every registered source's list at once (map/query.js), live, and
 * this bar reports what matched instead of asking you to choose one group out
 * of a dropdown.
 *
 * Not a list of things to click — the query already did the narrowing — so it
 * only needs to answer "how much" (a count per source) and offer two actions:
 * Fit the map to what matched, and clear the query.
 */
import { map } from "../map/instance.js";
import { img } from "../map/meta.js";
import { sources } from "../registry/sources-registry.js";
import { showAll } from "./filters.js";
import {
  getQuery, isActive, isLiteral, matches, setQuery, subscribe as subscribeQuery
} from "../map/query.js";

// Same reasoning as the private build's panel SEARCH_DEBOUNCE_MS: under the
// gap between keystrokes in ordinary typing, so the map and every list settle
// once per pause instead of once per character.
const SEARCH_DEBOUNCE_MS = 150;
// Past this many matched points, Fit stops widening the bounds it flies to —
// a query that matches most of a 1,562-row catalogue would otherwise compute
// a box around half the map, which is not a "fit" of anything useful.
const MAX_FIT_POINTS = 2000;

let input = null;
let summary = null;
let debounceTimer = null;
let renderScheduled = false;

/*
 * An AGGREGATE source (the private repo's own join-tab source — the public
 * build never registers one) holds no rows of its own — its rows are every
 * other source's rows wrapped — so counting it would report every match
 * twice: 12 pins would read "Pins 12 · All 12" and the total would be double
 * what actually matched. `aggregate` is a declared capability (see
 * registry/sources-registry.js), not a branch on source.id.
 */
function countableSources() {
  return sources().filter(function (s) { return !s.aggregate; });
}

function scheduleRender() {
  if (renderScheduled) { return; }
  renderScheduled = true;
  Promise.resolve().then(function () {
    renderScheduled = false;
    render();
  });
}

/**
 * One pass per source: a count of rows that actually earn a marker right now
 * and up to MAX_FIT_POINTS of their positions.
 *
 * `source.visible(row)` — discoveries/view.js, poi/view.js — is the SAME
 * predicate the marker layer rebuilds from (kind/category toggle, active map,
 * then the query last). Counting anything looser would let this bar claim a
 * match the map does not draw, which is exactly the bug a category toggle
 * used to cause: a query narrowed to a hidden kind still reported "8 match"
 * with nothing on screen.
 */
function collect() {
  let total = 0;
  const bits = [];
  const bounds = [];
  for (const source of countableSources()) {
    let n = 0;
    for (const row of source.rows()) {
      const hit = source.visible ? source.visible(row) : matches(source.searchText(row));
      if (!hit) { continue; }
      n++;
      if (bounds.length < MAX_FIT_POINTS) {
        const at = source.latLng(row);
        if (at) { bounds.push([at.lat, at.lng]); }
      }
    }
    total += n;
    bits.push(source.label + " " + n);
  }
  return { total: total, bits: bits, bounds: bounds };
}

/** Ported from the deleted poi/search.js — one row centres, several fit bounds. */
function flyToBounds(bounds) {
  if (!bounds.length) { return; }
  if (bounds.length === 1) {
    map.flyTo(bounds[0], Math.max(map.getZoom(), img.defaultZoom), { duration: 0.7 });
    return;
  }
  map.flyToBounds(L.latLngBounds(bounds).pad(0.35), {
    maxZoom: img.defaultZoom,
    duration: 0.75,
    easeLinearity: 0.2
  });
}

/*
 * Two things can leave the map showing nothing, and both are worth saying
 * out loud rather than leaving a reader to wonder whether the site is
 * broken: a query with no matches (the query IS active, so `collect` already
 * ran for it), or a category/layer toggle in the filter panel hiding
 * everything with no query at all. The bar is idle only when neither is
 * true — the ordinary case, or before anything has loaded.
 */
function render() {
  if (!summary) { return; }
  const active = isActive();
  const hit = collect();
  const loaded = countableSources().some(function (s) { return s.rows().length > 0; });

  if (!active && (hit.total > 0 || !loaded)) {
    summary.style.display = "none";
    summary.textContent = "";
    return;
  }

  summary.style.display = "flex";
  summary.textContent = "";

  const text = document.createElement("span");
  text.className = "search-summary-text";
  text.textContent = active
    ? hit.total + " match \u00b7 " + hit.bits.join(" \u00b7 ") +
      (isLiteral() ? " \u00b7 matching literally" : "")
    : "Filters hide everything on the map \u00b7 " + hit.bits.join(" \u00b7 ");
  summary.appendChild(text);

  if (active) {
    const fit = document.createElement("button");
    fit.type = "button";
    fit.className = "mg-btn";
    fit.textContent = "Fit";
    fit.disabled = !hit.bounds.length;
    fit.title = "Fly the map to every match";
    fit.addEventListener("click", function () { flyToBounds(hit.bounds); });
    summary.appendChild(fit);

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "mg-btn";
    clear.textContent = "\u2715";
    clear.title = "Clear the filter";
    clear.addEventListener("click", function () { setQuery(""); });
    summary.appendChild(clear);
  } else {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "mg-btn";
    reset.textContent = "Show all";
    reset.title = "Turn every category and layer back on";
    reset.addEventListener("click", showAll);
    summary.appendChild(reset);
  }
}

/** Binds #search and #search-summary. Safe to call once; no-ops without them. */
export function mount() {
  input = document.getElementById("search");
  summary = document.getElementById("search-summary");
  if (!input || !summary) { return; }

  input.addEventListener("input", function () {
    const value = this.value;
    if (debounceTimer !== null) { window.clearTimeout(debounceTimer); }
    debounceTimer = window.setTimeout(function () {
      debounceTimer = null;
      setQuery(value);
    }, SEARCH_DEBOUNCE_MS);
  });
  input.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") { return; }
    if (debounceTimer !== null) { window.clearTimeout(debounceTimer); debounceTimer = null; }
    this.value = "";
    setQuery("");
  });

  subscribeQuery(function () {
    // Mirror a change that came from elsewhere (the private build's own
    // #mg-search) without fighting an in-flight keystroke here — same
    // debounceTimer guard that box uses.
    if (debounceTimer === null && input.value !== getQuery()) { input.value = getQuery(); }
    scheduleRender();
  });

  // Counts move on their own too: a poll landing, a delete, a filter toggle
  // that took a row out of visibility does not change the query but does
  // change what "12 pins" means.
  for (const source of countableSources()) { source.onChange(scheduleRender); }

  render();
}
