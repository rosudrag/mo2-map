/*
 * Mortal Online 2 — Sarducaa: world metres <-> map canvas pixels.
 *
 * The map draws in Leaflet `CRS.Simple` pixels on a 5120x3579 canvas (`lat` = Y
 * from the bottom, `lng` = X from the left). World positions are Unreal world
 * METRES. This module is the whole transform between them, for anything
 * outside the browser bundle (scripts, tests, external tooling).
 * `public/map/registry.js`'s `sarducaa.world` block carries its own copy of
 * these exact numbers for the app to use at runtime — the two are kept in
 * sync by hand, not by import, so a re-fit has to update both. `test/
 * coordinates.test.mjs` checks this module, not that one.
 *
 * The constants describe THIS canvas. Re-cut the canvas without re-fitting and
 * every consumer is silently wrong — see docs/coordinates.md for the fit, its
 * residuals, and the one open question about the scale.
 */

/** The pixel frame the constants below were fitted against. */
export const CANVAS = Object.freeze({
  width: 5120,
  height: 3579,
  /** Metres per canvas pixel at the fitted scale. */
  metresPerPixel: 1 / 0.213641
});

/**
 * Axis-aligned, uniform scale, NO rotation. World +X is map east, world +Y is
 * map SOUTH — which is why `lat` carries the minus sign.
 */
export const WORLD = Object.freeze({
  pxPerMetre: 0.213641,
  originLng: 1783.4447,
  originLat: 1709.1136
});

/**
 * The 2026-08-10 origin correction, kept as data because it is the one thing a
 * reader of the anchor table below will otherwise get wrong.
 *
 * `originLat` was `fitOriginLat` until 2026-08-10, when live position markers
 * were observed rendering ~200 m NORTH of where they belonged and the origin
 * moved south to compensate. The anchors could not catch that error — they ARE
 * the measurement that was wrong — so this is a correction, not a re-fit, and
 * `pxPerMetre` is untouched.
 *
 * Consequence, and the reason this is exported: the anchors reproduce their
 * recorded residuals against `fitOriginLat`, NOT against the shipped
 * `WORLD.originLat`. Check the table against the shipped origin and every anchor
 * is ~200 m out, by construction and on purpose.
 */
export const FIT = Object.freeze({
  date: "2026-07-28",
  fitOriginLat: 1751.8418,
  correctedOn: "2026-08-10",
  correctionPx: -42.7282,
  correctionM: -200
});

/**
 * The three in-game anchors the scale was fitted over, kept beside the constants
 * so a re-fit can be checked rather than trusted. `residualM` is this anchor's
 * distance from where the FITTED transform puts it (see `FIT` above — the fit
 * origin, not the shipped one): identification precision, not model error. 1 px
 * is 4.7 m, and two of the three are recorded somewhere inside a town rather
 * than at its centre.
 */
export const ANCHORS = Object.freeze([
  Object.freeze({ name: "Ben Jedda", worldX: 2946.4157, worldY: -1938.3203, lat: 2176.0, lng: 2427.0, residualM: 81 }),
  Object.freeze({ name: "Bedia", worldX: 3202.2903, worldY: -3816.5842, lat: 2554.6, lng: 2460.5, residualM: 68 }),
  Object.freeze({ name: "Aur", worldX: 989.7323, worldY: -6545.9641, lat: 3152.9, lng: 1987.9, residualM: 35 })
]);

/** World metres -> canvas pixels. Returns null on non-finite input. */
export function worldToMap(worldX, worldY) {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
  return {
    lat: WORLD.originLat - WORLD.pxPerMetre * worldY,
    lng: WORLD.originLng + WORLD.pxPerMetre * worldX
  };
}

/** Canvas pixels -> world metres. Returns null on non-finite input. */
export function mapToWorld(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    x: (lng - WORLD.originLng) / WORLD.pxPerMetre,
    y: (WORLD.originLat - lat) / WORLD.pxPerMetre
  };
}

/**
 * Parses a pasted world position: "world:2946.4,-1938.3", "2946.4 -1938.3",
 * "2946.4; -1938.3". Returns `{ x, y }` in metres, or null if there is no pair
 * of numbers in the string. Deliberately lenient about the separator and
 * deliberately strict about the count: a single number is not a position.
 */
export function parseWorldPaste(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith("world:")) s = s.slice(6).trim();
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*[,;\s]+\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}
