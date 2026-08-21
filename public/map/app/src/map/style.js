/*
 * Which base tile pyramid is on the map: the hand-drawn artwork pyramid
 * (map/artwork-layer.js), which is the DEFAULT, or the realistic 0.585 m/px
 * placed-geometry render (map/instance.js), which is one click away and is
 * also the fallback whenever the artwork manifest is not on disk.
 *
 * The artwork is the default because it is the same measurements: the ground
 * families, the DEM, the coastline and the 38 M placed instances are the ones
 * the realistic raster is built from, so nothing is given up by drawing them by
 * hand - and the drawn sheet is the one worth looking at. The realistic map
 * stays for the job it is better at: reading exact terrain under a pin.
 *
 * This module is the SINGLE SOURCE OF TRUTH for the choice. Every other
 * artwork-aware piece of the page - the artwork skin (styles/artwork.css), the
 * town and dungeon plate sets, the poster export button - reads it through
 * isArtwork()/onStyleChange() rather than keeping its own flag, so there is
 * never a moment where the body class, the map container and some panel
 * disagree about which style is active.
 */
import { map } from "./instance.js";
import { setArtworkActive, artworkAvailable } from "./artwork-layer.js";
import { currentMapId } from "./current.js";

export const STYLES = { REALISTIC: "realistic", ARTWORK: "artwork" };

// Its own key, not shared with any other prefs blob - see discoveries/state.js
// for the same one-key-per-feature reasoning. Per-map: an artwork pyramid is
// a per-continent asset, so a style preference formed on one continent should
// not silently apply to a different one that may not even have artwork yet.
const STORAGE_KEY = "mo2map." + currentMapId() + ".style";
const BODY_CLASS = "style-artwork";
const CONTAINER_CLASS = "artwork";

let current = STYLES.ARTWORK;
// Set once by initStyle() after the manifest check settles. Guards setStyle()
// too, not just the button: without it a stray setStyle(ARTWORK) before (or
// when) the manifest is known missing would flip the skin on while
// setArtworkActive() has nothing to show, leaving parchment chrome around the
// realistic map.
let manifestKnownAvailable = false;
let toggleBtn = null;
const subscribers = [];

function loadStoredStyle() {
  // No stored preference means ARTWORK: the default lives here, not in the
  // absence of a key, so a first visit and a cleared browser agree.
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === STYLES.REALISTIC ? STYLES.REALISTIC : STYLES.ARTWORK;
  } catch {
    return STYLES.ARTWORK;
  }
}

function saveStoredStyle(style) {
  try { window.localStorage.setItem(STORAGE_KEY, style); } catch { /* private mode */ }
}

export function activeStyle() {
  return current;
}

export function isArtwork() {
  return current === STYLES.ARTWORK;
}

export function onStyleChange(fn) {
  subscribers.push(fn);
  return function unsubscribe() {
    const i = subscribers.indexOf(fn);
    if (i !== -1) subscribers.splice(i, 1);
  };
}

function otherStyle(style) {
  return style === STYLES.ARTWORK ? STYLES.REALISTIC : STYLES.ARTWORK;
}

function apply(style) {
  current = style;
  document.body.classList.toggle(BODY_CLASS, style === STYLES.ARTWORK);
  map.getContainer().classList.toggle(CONTAINER_CLASS, style === STYLES.ARTWORK);
  setArtworkActive(style === STYLES.ARTWORK);
  for (const fn of subscribers) { fn(style); }
}

export function setStyle(style) {
  const next = style === STYLES.ARTWORK ? STYLES.ARTWORK : STYLES.REALISTIC;
  // Nothing to switch to if the pyramid was never published - see the guard
  // comment on manifestKnownAvailable above.
  if (next === STYLES.ARTWORK && !manifestKnownAvailable) { return; }
  if (next === current) { return; }
  apply(next);
  saveStoredStyle(next);
}

// The button is labelled with the style it switches TO, so it reads as an
// action ("Switch to Artwork") rather than a status readout.
function paintButton() {
  if (!toggleBtn) { return; }
  const target = otherStyle(current);
  const name = target === STYLES.ARTWORK ? "Artwork" : "Realistic";
  toggleBtn.title = "Switch to the " + name.toLowerCase() + " map";
  toggleBtn.innerHTML = "Switch to <strong class=\"title-font\">" + name + "</strong>";
}
onStyleChange(paintButton);

function buildButton() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "style-toggle";
  btn.addEventListener("click", function () {
    setStyle(otherStyle(current));
  });
  document.body.appendChild(btn);
  toggleBtn = btn;
  paintButton();
}

/**
 * Wires the control and applies the stored style. A missing artwork manifest
 * is treated exactly like a missing dungeonplates.json (map/dungeonmode.js):
 * console.warn (from artwork-layer.js's own fetch) and carry on with no
 * button at all - there is nothing for it to switch to.
 */
export async function initStyle() {
  manifestKnownAvailable = await artworkAvailable();
  const stored = loadStoredStyle();
  // Artwork unless the reader asked for realistic, or the pyramid is missing.
  const initial = manifestKnownAvailable && stored !== STYLES.REALISTIC
    ? STYLES.ARTWORK
    : STYLES.REALISTIC;
  apply(initial);
  if (manifestKnownAvailable) { buildButton(); }
}
