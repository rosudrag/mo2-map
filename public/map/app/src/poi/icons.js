// Leaflet divIcons for the pin catalogue.
import { escapeHtml } from "../util/html.js";
import { iconSrc } from "../util/assets.js";
import { isTownCategory } from "./state.js";

// Plain pins are interchangeable, so they are memoised per colour+glyph. Town
// icons embed the place name and cannot be shared.
const iconCache = {};

/*
 * Glyph resolution order: a marker's own type-level icon wins over its
 * category icon, which falls back to the generic pin - a type is a narrower
 * classification than its category, so it is always the more specific glyph
 * when one is set. Turning the winner into a URL is util/assets.js's iconSrc,
 * shared with the filter panel, because a category's icon is drawn in both
 * places and a `game:` prefix only one of them understood is how the panel
 * ended up requesting `tabler/game:town.svg`.
 */
export function resolveIconSrc(typeIcon, categoryIcon) {
  return iconSrc(typeIcon || categoryIcon);
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
  if (isTownCategory(cat.id)) {
    return townIcon(cat.color, cat.icon, displayName, typeIcon);
  }
  return markerIcon(cat.color, cat.icon, typeIcon);
}
