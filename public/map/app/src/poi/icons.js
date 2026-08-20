// Leaflet divIcons for the pin catalogue.
import { escapeHtml } from "../util/html.js";
import { TABLER, GAMEICONS } from "../util/assets.js";

// Plain pins are interchangeable, so they are memoised per colour+glyph. Town
// icons embed the place name and cannot be shared.
const iconCache = {};

/*
 * Glyph resolution order: a marker's own
 * type-level icon wins over its category icon, which falls back to the
 * generic pin — a type is a narrower classification than its category, so it
 * is always the more specific glyph when one is set. `game:<name>` names one
 * of the seven SVGs redrawn from the game's own icon set rather than the
 * closed Tabler set.
 */
export function resolveIconSrc(typeIcon, categoryIcon) {
  const icon = typeIcon || categoryIcon || "map-pin";
  return icon.startsWith("game:")
    ? GAMEICONS + icon.slice("game:".length) + ".svg"
    : TABLER + icon + ".svg";
}

export function markerIcon(color, categoryIcon, typeIcon) {
  const src = resolveIconSrc(typeIcon, categoryIcon);
  const key = color + "|" + src;
  if (!iconCache[key]) {
    iconCache[key] = L.divIcon({
      className: "",
      html: '<div class="map-pin" style="--pin:' + color +
        '"><img src="' + src +
        '" alt="" width="15" height="15" /></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -16]
    });
  }
  return iconCache[key];
}

export function townIcon(color, categoryIcon, name, typeIcon) {
  const src = resolveIconSrc(typeIcon, categoryIcon);
  return L.divIcon({
    className: "town-marker-wrap",
    html:
      '<div class="town-marker">' +
      '<div class="map-pin" style="--pin:' + color +
      '"><img src="' + src +
      '" alt="" width="15" height="15" /></div>' +
      '<div class="town-label">' + escapeHtml(name) + "</div>" +
      "</div>",
    iconSize: [180, 56],
    iconAnchor: [90, 14],
    popupAnchor: [0, -16]
  });
}

export function poiIcon(cat, displayName, typeIcon) {
  if (cat.id === "towns") {
    return townIcon(cat.color, cat.icon, displayName, typeIcon);
  }
  return markerIcon(cat.color, cat.icon, typeIcon);
}
