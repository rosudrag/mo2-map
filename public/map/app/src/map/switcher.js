/*
 * The map switcher: which continent this page is showing, and the other two
 * you could look at instead.
 *
 * Always a full page navigation, never an in-place swap: the Leaflet map,
 * every marker source's data, every manifest cache (townplates.js and
 * dungeonmode.js both keep theirs for the page's whole life, by design) and
 * active-map.js's own state all belong to ONE continent's canvas and
 * transform. Tearing all of that down correctly for an in-place swap is a
 * lot of new code to save one already-cached, already-immutable
 * (.htaccess) vendor/leaflet.js request - not worth risking a leaked
 * Leaflet instance or a stale manifest showing the wrong continent's plates.
 *
 * An unpublished entry stays in the menu rather than being disabled: its URL
 * is real and someone may already have it bookmarked or shared it, so the
 * honest move is to say plainly what's there when they arrive, not to hide
 * the door. See public/map/<mapId>/index.html for what that page shows -
 * this menu's label carries the same `unpublishedReason` text.
 *
 * Preserves which BUILD the reader is on (the live build, or the
 * public static build) when moving to another PUBLISHED continent.
 * window.__MO2_BUILD__ is set inline by index.html/static.html, before this
 * bundle even loads, because the URL alone cannot say which build served it:
 * a bare "/map/sarducaa/" request serves index.html by default (router.php),
 * so the live build's own address bar very often carries no filename at
 * all. An unpublished continent has no such split - one page, not two - so
 * it is always reached at its bare directory URL regardless of build.
 */
import { openMenu } from "../ui/picker.js";
import { mapMeta } from "./meta.js";
import { MAPS } from "../../../registry.js";

function hrefFor(entry, build) {
  if (!entry.published) { return "../" + entry.id + "/"; }
  return build === "static" ? "../" + entry.id + "/static.html" : "../" + entry.id + "/";
}

function menuItems(currentId) {
  return Object.keys(MAPS)
    .map(function (id) { return MAPS[id]; })
    .sort(function (a, b) { return a.sortOrder - b.sortOrder; })
    .map(function (entry) {
      return {
        value: entry.id,
        label: entry.published ? entry.title : entry.title + " \u2014 " + entry.unpublishedReason,
        active: entry.id === currentId
      };
    });
}

/**
 * Wires the switcher button. Unconditional, unlike the Style/Dungeon/Poster
 * buttons above it in the corner stack: the registry is always present, so
 * there is nothing to probe first and no reason this could ever have
 * nothing to show.
 */
export function initSwitcher() {
  const build = window.__MO2_BUILD__ === "static" ? "static" : "live";
  const currentId = mapMeta.id;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "map-switcher";
  btn.className = "mg-btn";
  btn.title = "Switch continent";
  btn.textContent = mapMeta.title.replace(/ Map$/, "") + " \u25be";
  document.body.appendChild(btn);

  btn.addEventListener("click", function () {
    openMenu(btn, {
      title: "Maps",
      items: menuItems(currentId),
      onPick: function (value) {
        if (value === currentId) { return; }
        const entry = MAPS[value];
        if (!entry) { return; }
        window.location.href = hrefFor(entry, build);
      }
    });
  });
}
