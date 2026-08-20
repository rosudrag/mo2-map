/*
 * The first-run legend: what a pin's ring style, its count badge and a
 * numbered bubble mean, spelled out once instead of left for a reader to
 * reverse-engineer from a screenshot. Opens itself the first time this map
 * loads in a browser (cold localStorage) and stays reachable afterward from
 * its own button next to the search box — the same "ask once, offer
 * forever" shape as every other localStorage-backed preference on this page
 * (map/style.js's style choice, discoveries/state.js's own prefs key).
 *
 * Static markup (public/map/<mapId>/index.html) plus this file's open/close
 * wiring — no data dependency, so it mounts synchronously beside
 * filters.mount()/search.mount() rather than waiting on a source to load.
 */
import { currentMapId } from "../map/current.js";

const SEEN_KEY = "mo2map." + currentMapId() + ".legend-seen";

function hasSeen() {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch (err) {
    // Private browsing / storage disabled: fall back to "never seen", so the
    // legend opens every visit rather than silently never explaining itself.
    return false;
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch (err) {
    // Nothing to persist to; the panel still works for this one visit.
  }
}

/** Wires #legend-toggle / #legend-panel if the page carries them. Safe to call once. */
export function mount() {
  const toggle = document.getElementById("legend-toggle");
  const panel = document.getElementById("legend-panel");
  if (!toggle || !panel) { return; }

  function open() {
    panel.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
    markSeen();
  }
  function close() {
    panel.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }

  toggle.addEventListener("click", function () {
    if (panel.classList.contains("open")) { close(); } else { open(); }
  });
  const closeBtn = panel.querySelector("[data-legend-close]");
  if (closeBtn) { closeBtn.addEventListener("click", close); }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel.classList.contains("open")) { close(); }
  });

  if (!hasSeen()) { open(); }
}
