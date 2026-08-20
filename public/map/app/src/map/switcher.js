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
 * Carries the reader's OWN page filename across to the next continent, which
 * is how the same bundle serves two deployments without being told which one
 * it is in. This repo publishes each continent as `<mapId>/index.html`, so a
 * reader is on a bare directory URL and the next continent is too. A
 * deployment that adds a second page per continent alongside it - a live
 * build at index.html and this static one at static.html, say - keeps the
 * reader on the page they were already on, because the filename they arrived
 * at is the filename they leave with.
 *
 * Reading the filename beats a build flag set inline by each page: the flag
 * had to be maintained in every HTML shell in every deployment, and could
 * disagree with the file actually being served. The URL cannot lie about it.
 *
 * An unpublished continent has one page, not two, so it is always reached at
 * its bare directory URL.
 */
import { openMenu } from "../ui/picker.js";
import { mapMeta } from "./meta.js";
import { MAPS } from "../../../registry.js";

/** This page's own filename, or "" when it was served from a directory URL. */
function pageFile() {
  const last = window.location.pathname.split("/").pop();
  return last && last.indexOf(".") !== -1 ? last : "";
}

function hrefFor(entry) {
  if (!entry.published) { return "../" + entry.id + "/"; }
  return "../" + entry.id + "/" + pageFile();
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
        window.location.href = hrefFor(entry);
      }
    });
  });
}
