import test from "node:test";
import assert from "node:assert/strict";
import {
  ANCHORS, CANVAS, FIT, WORLD, mapToWorld, parseWorldPaste, worldToMap
} from "../src/coordinates.js";

/*
 * Contract tests, not arithmetic tests. Each one fails on a plausible mistake
 * somebody could make while refactoring the projection: flipping the lat sign,
 * dropping the origin, quietly re-fitting instead of correcting, or letting a
 * NaN through a range check and out onto the map as a marker at nowhere.
 */

/** Where the FITTED transform puts an anchor — the fit origin, not the shipped one. */
function fitted(anchor) {
  return {
    lat: FIT.fitOriginLat - WORLD.pxPerMetre * anchor.worldY,
    lng: WORLD.originLng + WORLD.pxPerMetre * anchor.worldX
  };
}

test("every anchor reproduces its recorded residual under the fit origin", () => {
  for (const a of ANCHORS) {
    const p = fitted(a);
    const offM = Math.hypot(p.lat - a.lat, p.lng - a.lng) * CANVAS.metresPerPixel;
    // 1 m of slack for the rounding in the published anchor table.
    assert.ok(
      Math.abs(offM - a.residualM) <= 1,
      `${a.name}: ${offM.toFixed(1)} m, recorded ${a.residualM} m`
    );
  }
});

test("the shipped origin is the fit origin corrected 200 m south, exactly", () => {
  const px = WORLD.originLat - FIT.fitOriginLat;
  assert.ok(Math.abs(px - FIT.correctionPx) < 1e-4, `correction is ${px} px`);
  const metres = px * CANVAS.metresPerPixel;
  assert.ok(Math.abs(metres - FIT.correctionM) < 0.5, `correction is ${metres} m`);
  assert.ok(px < 0, "the correction moves the origin SOUTH");
});

test("the correction is a correction, not a re-fit: scale is untouched", () => {
  // A re-fit would have moved pxPerMetre too. It did not, and the independent
  // registration chain that confirms it to 0.3% is what licenses that.
  assert.equal(WORLD.pxPerMetre, 0.213641);
  assert.ok(Math.abs(CANVAS.metresPerPixel - 4.6807) < 1e-3);
});

test("world -> map -> world is the identity", () => {
  for (const [x, y] of [[0, 0], [2946.4157, -1938.3203], [-8100, 7700], [15618, -8552]]) {
    const p = worldToMap(x, y);
    const w = mapToWorld(p.lat, p.lng);
    assert.ok(Math.abs(w.x - x) < 1e-6, `x ${w.x} != ${x}`);
    assert.ok(Math.abs(w.y - y) < 1e-6, `y ${w.y} != ${y}`);
  }
});

test("world +Y is map SOUTH, world +X is map east", () => {
  const origin = worldToMap(0, 0);
  assert.ok(worldToMap(0, 1000).lat < origin.lat, "increasing world Y must decrease lat");
  assert.ok(worldToMap(1000, 0).lng > origin.lng, "increasing world X must increase lng");
});

test("the whole island lands inside the canvas", () => {
  // The island occupies roughly X -8100..7900, Y -7750..7700. If a constant
  // moves and this fails, the map is drawing terrain off the edge of its frame.
  for (const [x, y] of [[-8100, -7750], [7900, 7700], [-8100, 7700], [7900, -7750]]) {
    const p = worldToMap(x, y);
    assert.ok(p.lng >= 0 && p.lng <= CANVAS.width, `lng ${p.lng} outside 0..${CANVAS.width}`);
    assert.ok(p.lat >= 0 && p.lat <= CANVAS.height, `lat ${p.lat} outside 0..${CANVAS.height}`);
  }
});

test("world origin sits at the shipped canvas origin", () => {
  const p = worldToMap(0, 0);
  assert.equal(p.lat, WORLD.originLat);
  assert.equal(p.lng, WORLD.originLng);
});

test("non-finite input yields null rather than a marker at nowhere", () => {
  for (const bad of [[NaN, 0], [0, NaN], [Infinity, 0], [undefined, 0], ["x", 0]]) {
    assert.equal(worldToMap(bad[0], bad[1]), null);
    assert.equal(mapToWorld(bad[0], bad[1]), null);
  }
});

test("paste accepts the shapes people actually paste", () => {
  const want = { x: 2946.4, y: -1938.3 };
  for (const s of [
    "world:2946.4,-1938.3",
    "world: 2946.4, -1938.3",
    "2946.4,-1938.3",
    "2946.4 -1938.3",
    "2946.4; -1938.3",
    "  2946.4 , -1938.3  "
  ]) {
    assert.deepEqual(parseWorldPaste(s), want, s);
  }
});

test("paste refuses what is not a position", () => {
  for (const s of ["", null, undefined, "2946.4", "nowhere", "world:"]) {
    assert.equal(parseWorldPaste(s), null, JSON.stringify(s));
  }
});
