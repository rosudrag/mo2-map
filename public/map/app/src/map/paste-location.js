// "Paste a world coordinate and pin it" toolbar field.
import { map } from "./instance.js";
import { worldToMap, parseWorldPaste } from "./projection.js";

const pasteGroup = L.layerGroup().addTo(map);
let pasteCount = 0;
function addWorldPasteMarker(worldX, worldY) {
  const p = worldToMap(worldX, worldY);
  if (!p) return false;
  pasteCount += 1;
  const label = "#" + pasteCount;
  const mk = L.marker([p.lat, p.lng], {
    icon: L.divIcon({
      className: "",
      html: '<div class="paste-pin"><span>' + label + "</span></div>",
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    }),
    zIndexOffset: 850,
    title: "Pinned " + worldX.toFixed(0) + "," + worldY.toFixed(0)
  });
  mk.bindPopup(
    '<div class="marker-popup"><h5>Pinned ' + label + "</h5>" +
    '<div class="layer">world X ' + worldX.toFixed(0) + " · Y " + worldY.toFixed(0) + "</div></div>"
  );
  pasteGroup.addLayer(mk);
  map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 1), { duration: 0.7 });
  mk.openPopup();
  return true;
}

const pasteInput = document.getElementById("paste-loc");
const pasteGo = document.getElementById("paste-loc-go");
function runPasteLocation(raw) {
  const parsed = parseWorldPaste(raw);
  if (!parsed) {
    pasteInput.focus();
    pasteInput.select();
    return false;
  }
  if (!addWorldPasteMarker(parsed.x, parsed.y)) {
    pasteInput.focus();
    return false;
  }
  pasteInput.value = parsed.x.toFixed(0) + "," + parsed.y.toFixed(0);
  return true;
}
function pasteLocFromFieldOrClipboard() {
  const typed = pasteInput.value.trim();
  if (typed) {
    runPasteLocation(typed);
    return;
  }
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(function (clip) {
      pasteInput.value = String(clip || "").trim();
      runPasteLocation(pasteInput.value);
    }).catch(function () {
      pasteInput.focus();
    });
  } else {
    pasteInput.focus();
  }
}
pasteGo.addEventListener("click", pasteLocFromFieldOrClipboard);
pasteInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    e.preventDefault();
    pasteLocFromFieldOrClipboard();
  }
});
