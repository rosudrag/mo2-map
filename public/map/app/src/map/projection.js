import { mapMeta } from "./meta.js";

// ---- UE world metres <-> canvas pixels -------------------------------
// Single source of truth: this map's own `world` block in
// public/map/registry.js (see there for the fit and its anchors). The
// callers push RAW world metres and never carry a copy of these
// constants — the map art and the numbers that describe it must change in
// the same commit.
export const worldCal = mapMeta.world || null;
export function worldToMap(worldX, worldY) {
  if (!worldCal || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
  return {
    lat: worldCal.originLat - worldCal.pxPerMetre * worldY,
    lng: worldCal.originLng + worldCal.pxPerMetre * worldX
  };
}
export function mapToWorld(lat, lng) {
  if (!worldCal || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    x: (lng - worldCal.originLng) / worldCal.pxPerMetre,
    y: (worldCal.originLat - lat) / worldCal.pxPerMetre
  };
}

export function parseWorldPaste(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (s.toLowerCase().indexOf("world:") === 0) s = s.slice(6).trim();
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*[,;\s]+\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: x, y: y };
}
