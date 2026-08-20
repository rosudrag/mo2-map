// Cursor position readout (bottom-left) plus click-to-copy world coords.
import { map } from "./instance.js";
import { mapToWorld } from "./projection.js";
import { mapClickClaimed } from "./click-claim.js";

const coordsEl = document.getElementById("coords");
let lastLat = NaN, lastLng = NaN;
function fmtCoord(n) {
  return Number.isFinite(n) ? n.toFixed(1) : "—";
}
export function renderCoords(extra) {
  const w = mapToWorld(lastLat, lastLng);
  coordsEl.innerHTML =
    "lat " + fmtCoord(lastLat) + " · lng " + fmtCoord(lastLng) +
    (w ? "<br />world X " + w.x.toFixed(0) + " · Y " + w.y.toFixed(0) : "") +
    "<br /><span class=\"hint\">" + (extra || "click copy world · right-click add") + "</span>";
}
map.on("mousemove", function (e) {
  lastLat = e.latlng.lat;
  lastLng = e.latlng.lng;
  renderCoords();
});
map.on("mouseout", function () {
  lastLat = NaN;
  lastLng = NaN;
  renderCoords();
});
map.on("click", function (e) {
  // A feature may own the empty-map click (bookmark edit mode places a pin
  // there). With no claimant the original clipboard-copy gesture runs — that is
  // how calibration anchors are taken (see docs/map-coordinates.md).
  if (mapClickClaimed(e.latlng)) { return; }
  lastLat = e.latlng.lat;
  lastLng = e.latlng.lng;
  const w = mapToWorld(lastLat, lastLng);
  const text = w
    ? w.x.toFixed(0) + "," + w.y.toFixed(0)
    : lastLat.toFixed(1) + "," + lastLng.toFixed(1);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      renderCoords("copied world " + text);
    }).catch(function () {
      renderCoords(text);
    });
  } else {
    renderCoords(text);
  }
});
