/*
 * Sarducaa map page entry point — the public, static build.
 *
 * Same map, same marker layers, same filter panel and search box as main.js.
 * The difference is entirely in what gets registered and mounted: no
 * bookmarks (personal, per-user, needs an account and a key — none of which
 * exist here), no presence (a live feed with nothing to feed it), no row
 * list / field editor (nothing here can be authored — there is no API behind
 * this build at all), and the one catalogue reads a committed JSON snapshot
 * instead of the live API.
 *
 * This file, and everything it imports, MUST carry zero network code to a live
 * endpoint — no src/config.js, no src/bookmarks/, no src/presence/, no write
 * path of any kind. That is not a style preference: it is the one thing a
 * reader of a public map is entitled to assume when the page never asks them
 * to log in. See sources/static/points.js and poi/view.js for how the live
 * and static sources share everything that is not transport.
 */
import "./util/legacy-prefs.js";
import "./map/instance.js";
import "./map/paste-location.js";
import { initTownPlates } from "./map/townplates.js";
import { initSurfacePlates } from "./map/surfaceplates.js";
import { initDungeonMap } from "./map/dungeonmode.js";
import { initStyle } from "./map/style.js";
import { initPoster } from "./map/poster.js";
import { initSwitcher } from "./map/switcher.js";
import { renderCoords } from "./map/coords-readout.js";
import { register } from "./registry/sources-registry.js";
import * as filters from "./view/filters.js";
import * as search from "./view/search.js";
import * as legend from "./view/legend.js";
import points from "./sources/static/points.js";

// The one catalogue this build can show. main.js also registers a join tab
// ("All"), bookmarks and a discoveries feed first; this build has none of
// those — no aggregate view, nothing personal to aggregate, and nothing
// live to auto-discover into a second catalogue — so it registers only the
// one committed snapshot a reader can actually see.
register(points);

// Mounted synchronously, BEFORE the first load resolves — see main.js for why.
filters.mount();
search.mount();
legend.mount();

/**
 * Boots one source on a promise chain of its own. Identical to main.js's
 * bootSource and kept identical on purpose: the isolation story (one source's
 * outage is not the others' problem, and a synchronous throw must not stop
 * sources registered after it) does not change just because the transport did.
 */
function bootSource(source, onFail) {
  function failed(err) {
    console.error(source.id + " failed to load", err);
    if (onFail) { onFail(); }
  }
  try {
    source.load().catch(failed);
  } catch (err) {
    failed(err);
  }
}

bootSource(points, function () {
  // The catalogue is the only source whose absence is otherwise invisible: its
  // points are the map, and an empty map looks like a valid empty map. Say so.
  renderCoords("points.json unavailable");
});

// Town plates + their POIs. Independent of every marker source: the manifest
// is a static asset, so a points-outage cannot hide the plates and a missing
// manifest cannot hide the points.
initTownPlates().catch((err) => console.warn("town plates failed:", err));

// Dungeon-surface plates: the same idea, over a dungeon's own entrances
// instead of a town. Independent for the same reason.
initSurfacePlates().catch((err) => console.warn("surface plates failed:", err));

// The dungeon map. Independent of every marker source for the same reason as
// the town plates, and entered from a pin's popup or the Dungeons button
// rather than by finding a zoom level - see map/dungeonmode.js.
initDungeonMap().catch((err) => console.warn("dungeon map failed:", err));

// The artwork style switch. Independent of every marker source for the same
// reason as the two above: a missing assets/tiles-art/ manifest just means
// there is nothing to switch to yet, not that the realistic map is broken.
initStyle().catch((err) => console.warn("artwork style failed:", err));

// The poster export. Independent of every marker source and of the style
// switch above for the same reason: a missing assets/tiles-art/ manifest just
// means there is nothing to export yet, and the button (map/poster.js) never
// appears rather than erroring.
initPoster().catch((err) => console.warn("poster export failed:", err));

// The map switcher. Unlike the three above, it reads only the registry
// (always present, never fetched), so it must never be blocked by them and
// must never block them either - a synchronous throw here must not stop a
// source that boots after it, same reasoning as bootSource's own try/catch.
try {
  initSwitcher();
} catch (err) {
  console.warn("map switcher failed:", err && err.message);
}
