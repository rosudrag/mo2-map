// The YOU blip: a you-are-here marker driven by whatever host page calls
// window.setMo2World(x, y, follow, ...); when nobody calls it, no blip renders.
//
// Extracted out of the POI catalogue boot() because it must survive a
// map-data outage (the pin catalogue can fail and the player marker must
// still work) and because bookmark features want to read the live position.
//
// Deliberately does not import presence/publish.js: that module talks to the
// live API, and this one is imported unconditionally by manage/list.js (for
// the "nearest to you" sort) — including by the static, API-less build. See
// onYouWorldReported below for how the two stay connected anyway.
import { map } from "../map/instance.js";
import { worldToMap, mapToWorld } from "../map/projection.js";
import { ueYawToMapDeg, headingArrowHtml } from "../map/heading.js";
import { escapeHtml } from "../util/html.js";

const params = new URLSearchParams(location.search);
let youMarker = null;
let youWorld = null;
let youYaw = null;
let localPlayerName = null;

function youPopupHtml() {
  let html = youWorld
    ? "<b>" + escapeHtml(localPlayerName || "YOU") + "</b><br />world X " +
      youWorld.x.toFixed(0) + " · Y " + youWorld.y.toFixed(0)
    : "<b>" + escapeHtml(localPlayerName || "YOU") + "</b>";
  if (Number.isFinite(youYaw)) html += "<br />heading " + youYaw.toFixed(0) + "°";
  return html;
}

function youIconHtml() {
  const mapDeg = ueYawToMapDeg(youYaw);
  const label = escapeHtml(localPlayerName || "YOU");
  return (
    '<div class="you-marker">' +
    headingArrowHtml("#c4a574", mapDeg, "you-blip") +
    '<div class="you-label">' + label + "</div></div>"
  );
}

function setYou(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const icon = L.divIcon({
    className: "you-blip-wrap",
    html: youIconHtml(),
    iconSize: [140, 52],
    iconAnchor: [70, 14]
  });
  if (youMarker) {
    youMarker.setLatLng([lat, lng]);
    youMarker.setIcon(icon);
    youMarker.setPopupContent(youPopupHtml());
  } else {
    youMarker = L.marker([lat, lng], {
      icon: icon,
      zIndexOffset: 1000,
      title: localPlayerName || "YOU"
    }).addTo(map);
    youMarker.bindPopup(youPopupHtml());
  }
}

// World metres in, canvas pixels out. Returns false when the map has no
// calibration block (art swapped without re-fitting) so callers can say
// so instead of dropping the blip at the origin.
export function setYouWorld(worldX, worldY, yawDeg) {
  const p = worldToMap(worldX, worldY);
  if (!p) return false;
  youWorld = { x: worldX, y: worldY };
  if (Number.isFinite(yawDeg)) youYaw = yawDeg;
  setYou(p.lat, p.lng);
  return true;
}

// ?you=lat,lng (canvas pixels) or ?you=world:X,Y (UE metres)
if (params.has("you")) {
  const raw = params.get("you").trim();
  const isWorld = raw.toLowerCase().indexOf("world:") === 0;
  const parts = (isWorld ? raw.slice(6) : raw).split(",").map(Number);
  if (parts.length === 2 && parts.every(Number.isFinite)) {
    const ok = isWorld ? setYouWorld(parts[0], parts[1]) : (setYou(parts[0], parts[1]), true);
    if (ok && youMarker) map.setView(youMarker.getLatLng(), Math.max(map.getZoom(), 1));
  }
}

window.setMo2You = function (lat, lng, follow) {
  youWorld = mapToWorld(lat, lng);
  setYou(lat, lng);
  if (follow) map.setView([lat, lng], Math.max(map.getZoom(), 0));
};

// Registered by presence/layer.js, live build only: the static build never
// imports that module, so this stays null and setMo2World simply has nothing
// to call — the same optional-hook shape as setMarkerActions / attachStore.
let onWorldReported = null;
export function onYouWorldReported(fn) {
  onWorldReported = fn;
}

// What the host page calls via window.setMo2World: raw UE world metres, projected here.
window.setMo2World = function (worldX, worldY, follow, playerName, worldZ, yawDeg) {
  if (playerName && String(playerName).trim()) {
    localPlayerName = String(playerName).trim();
  }
  if (!setYouWorld(worldX, worldY, yawDeg)) return false;
  if (follow) map.setView(youMarker.getLatLng(), Math.max(map.getZoom(), 0));
  if (onWorldReported) { onWorldReported(worldX, worldY, worldZ, yawDeg, localPlayerName); }
  return true;
};

// Read-only accessor: the live world position, or null when the host page has
// never called setMo2World. Returns a copy so a consumer cannot mutate the blip.
export function getYouWorld() {
  return youWorld ? { x: youWorld.x, y: youWorld.y } : null;
}

// Read-only accessor: the name last reported via setMo2World, or
// null. The presence layer uses it to skip rendering a duplicate dot for the
// local player.
export function getLocalPlayerName() {
  return localPlayerName;
}
