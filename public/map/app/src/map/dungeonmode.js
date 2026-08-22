/*
 * The dungeon map: a MODE you enter, not a layer you find.
 *
 * The first cut of this was a zoom-gated panel - pan into a dungeon's bounds,
 * zoom past 0.5, notice a control in the corner, flip a toggle. Every one of
 * those four steps is the user doing the map's job. A dungeon is a destination,
 * so it is reached the way destinations are: its pin is on the surface map at any
 * zoom, its popup says "Open dungeon map", and taking that offer flies the view
 * to the level's own bounds, replaces the surface with the interior and puts a
 * bar across the top with the levels in it. `Leave` (or Escape) puts the view
 * back exactly where it was.
 *
 * The plates themselves are 0.25 m/px renders of each dungeon LEVEL's own placed
 * geometry (built by the offline pipeline), 108-625 KB each,
 * registered on the same canvas frame as the terrain - so an interior sits under
 * the ground it is actually under, and the entrance pins land on their own
 * doorways.
 *
 * On the "megabyte layers must be view-gated" rule (townplates.js): this layer
 * satisfies it structurally instead. A mode is one dungeon and one level, so at
 * most ONE plate is ever in the map, and it exists only while the user is
 * deliberately inside it. Panning within a dungeon does not churn it.
 *
 * Two manifests, one per map/style.js STYLE, identical schema either way
 * (dungeon_plate.py: `publish`/`publish-art`) - which is on screen is decided
 * by style.js, never guessed here. The realistic manifest is the baseline this
 * feature has always required; the artwork one is fetched lazily on first use
 * and, missing or not, the dungeon map never goes blank over it (loadManifest).
 */
import { map } from "./instance.js";
import { openMenu, closePicker } from "../ui/picker.js";
import { setDungeonLink, dungeonKeyOf, flushLayerRebuild } from "../poi/markers.js";
import { getMarkers } from "../poi/state.js";
import { GAMEICONS } from "../util/assets.js";
import { STYLES, isArtwork, onStyleChange } from "./style.js";
import { SURFACE_MAP, setActiveMap } from "./active-map.js";
import { surfaceBoundsFor } from "./surfaceplates.js";

const MANIFEST_URL = {};
MANIFEST_URL[STYLES.REALISTIC] = "assets/dungeonplates/dungeonplates.json";
MANIFEST_URL[STYLES.ARTWORK] = "assets/dungeonplates-art/dungeonplates-art.json";

// Sits ABOVE townPlatePane (260, town_plate.py's apron) so an interior wins over
// the town plate an entrance may stand inside, and BELOW every marker pane -
// discoveries at 590 is the lowest - so pins stay clickable over an interior.
const PLATE_PANE = "dungeonPlatePane";

// Stepping OUT of a dungeon onto the surface: when the dungeon has a
// high-res surface plate (map/surfaceplates.js - dungeon_plate.py's
// render_dungeon_surface, 0.25 m/px like the interior) the view fits that
// plate's own bounds, same as entering fits a level's bounds. Without one
// (not yet rendered for this dungeon) it falls back to a flat zoom close
// enough to see the door without landing inside a single blurred island
// tile - both styles' island pyramids are 0.585 m/px at their own native
// zoom now (tiles-art/v3 matched tiles/v5's resolution; before that the
// artwork style topped out at 2.34 m/px and this zoom was chosen to avoid
// its blur specifically).
const SURFACE_STEP_ZOOM = 3;

// Built from SURFACE_MAP rather than a literal /^sarducaa\//: a map id is
// data (map/current.js reads it from the URL this page was loaded at), and
// splicing a raw string into a regex is exactly how an injection bug starts -
// escaped defensively even though every id in use today is a plain lowercase
// word. Built once, not per call: SURFACE_MAP never changes within one page
// load.
const DUNGEON_LINK_RE = new RegExp(
  "^" + SURFACE_MAP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/([a-z0-9_]+)/(\\d+)$"
);

// While an interior is on screen the SURFACE has to get out of the way. As a
// plain overlay it did not: lit island terrain (0.585 m/px, either style)
// surrounded the plate's footprint and still read through the 10%
// backdrop the renderer leaves, so a dungeon looked like the overworld with a
// floor plan pasted on it. Styles in dungeonmode.css.
const MODE_CLASS = "in-dungeon";

let state = null;

// { dungeons, order } per style, fetched once and kept - a style toggle never
// re-downloads a manifest it already has. `null` means confirmed missing.
const manifestCache = {};
const warnedMissing = {};

function buildSet(manifest) {
  const dungeons = {};
  const order = [];
  (manifest.dungeons || []).forEach(function (d) {
    const levels = (d.levels || [])
      .slice()
      .sort(function (a, b) { return a.level - b.level; })
      .map(function (lvl) { return { data: lvl, bounds: L.latLngBounds(lvl.bounds) }; });
    // A dungeon with no rendered level has nothing to enter.
    if (!levels.length) { return; }
    dungeons[d.key] = { key: d.key, label: d.label || d.key, levels: levels };
    order.push(d.key);
  });
  return { dungeons: dungeons, order: order };
}

async function loadManifest(style) {
  if (Object.prototype.hasOwnProperty.call(manifestCache, style)) {
    return manifestCache[style];
  }
  try {
    const res = await fetch(MANIFEST_URL[style], { cache: "no-cache" });
    if (!res.ok) { throw new Error("HTTP " + res.status); }
    const manifest = await res.json();
    const built = buildSet(manifest);
    manifestCache[style] = built.order.length ? built : null;
  } catch (err) {
    // A deploy can ship terrain without one style's dungeon plates - they are
    // generated (and published) separately, per style. The rest of the map is
    // unaffected, so this is a note, and it fires once per style.
    if (!warnedMissing[style]) {
      console.warn("dungeon plates unavailable (" + style + "):", err && err.message);
      warnedMissing[style] = true;
    }
    manifestCache[style] = null;
  }
  return manifestCache[style];
}

/*
 * A level's elevation range, as the bar shows it.
 *
 * An en dash cannot separate these: Sarducaa's dungeons sit BELOW sea level
 * (-334.8 m), so `-305--241 m` is what a dash range renders as. Real minus signs
 * and the word "to".
 */
export function fmtDepth(depthM) {
  if (!depthM || depthM.length !== 2) { return ""; }
  const m = function (v) { return (v < 0 ? "\u2212" : "") + Math.abs(Math.round(v)); };
  return m(depthM[0]) + " to " + m(depthM[1]) + " m";
}

/*
 * What the reader is looking at, or null on the surface.
 *
 * The seam the poster export (map/poster-dungeon.js) reads: while a dungeon is
 * open, "export the map" means this dungeon's plans and not the terrain the
 * mode is deliberately hiding. It hands out the manifest's own level records -
 * `file`, `bounds`, `depthM`, `metresPerPx`, `sections` - for whichever STYLE
 * is actually on screen, so an export is what the reader sees, including the
 * realistic fallback when the artwork plates are missing (loadManifest).
 */
export function currentDungeon() {
  if (!state) { return null; }
  return {
    key: state.dungeon.key,
    label: state.dungeon.label,
    levels: state.dungeon.levels.map(function (l) { return l.data; }),
    level: state.level.data
  };
}

/*
 * The bar, and the button that opens the dungeon list.
 *
 * Both are plain absolutely-positioned chrome rather than L.control: the page's
 * own panels (#filter-panel and, on the private build, its row-catalogue panel) are, and a Leaflet control would put
 * a full-width bar inside a corner container sized for two 26px buttons.
 */
function buildChrome() {
  const entry = document.createElement("button");
  entry.type = "button";
  entry.id = "dungeon-entry";
  entry.title = "Open a dungeon map";
  entry.innerHTML =
    '<img src="' + GAMEICONS + 'dungeon.svg" alt="" width="16" height="16" />' +
    "<span>Dungeons</span>";

  const bar = document.createElement("div");
  bar.id = "dungeon-bar";
  bar.innerHTML =
    '<div class="dg-title">' +
    '<img src="' + GAMEICONS + 'dungeon.svg" alt="" width="18" height="18" />' +
    "<strong></strong><span>dungeon map</span></div>" +
    '<div class="dg-levels"></div>' +
    '<button type="button" class="dg-exit" title="Back to the surface (Esc)">Leave</button>';

  document.body.appendChild(entry);
  document.body.appendChild(bar);
  return {
    entry: entry,
    bar: bar,
    name: bar.querySelector("strong"),
    levels: bar.querySelector(".dg-levels"),
    exit: bar.querySelector(".dg-exit")
  };
}

export async function initDungeonMap() {
  let active = null;       // { dungeons, order } currently on screen
  let activeStyle = null;  // matching STYLES.*, or null before the first load

  function paintLevels() {
    ui.levels.innerHTML = "";
    state.dungeon.levels.forEach(function (lvl) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dg-lvl" + (lvl === state.level ? " active" : "");
      btn.innerHTML = "Level " + lvl.data.level +
        '<small>' + fmtDepth(lvl.data.depthM) + "</small>";
      btn.addEventListener("click", function () { selectLevel(lvl); });
      ui.levels.appendChild(btn);
    });
  }

  function showPlate() {
    if (state.overlay) {
      map.removeLayer(state.overlay);
      state.overlay = null;
    }
    state.overlay = L.imageOverlay(state.level.data.file, state.level.bounds, {
      pane: PLATE_PANE,
      interactive: false,
      className: "dungeon-plate"
    }).addTo(map);
  }

  /*
   * The plate on screen AND the map the page is on.
   *
   * A level is its own map (`level.data.map`, published by dungeon_plate.py):
   * showing a plate without switching maps left every surface pin floating over
   * the floor plan, and no dungeon pin visible at all. One call does both, so
   * the two can never disagree.
   */
  function showLevel() {
    showPlate();
    setActiveMap(state.level.data.map || SURFACE_MAP);
  }

  function selectLevel(lvl) {
    if (!state || state.level === lvl) { return; }
    const wasOutside = !map.getBounds().intersects(lvl.bounds);
    state.level = lvl;
    showLevel();
    paintLevels();
    // Levels of one dungeon overlap, so the view is left alone unless the new
    // level is somewhere else entirely - refitting on every switch would throw
    // the reader out of the room they were reading.
    if (wasOutside) { map.fitBounds(lvl.bounds, { padding: [40, 40] }); }
  }

  function enter(key, levelNumber) {
    const dungeon = active.dungeons[key];
    if (!dungeon) { return; }
    if (state && state.dungeon === dungeon) {
      if (levelNumber != null) {
        const want = dungeon.levels.find(function (l) { return l.data.level === levelNumber; });
        if (want) { selectLevel(want); }
      }
      return;
    }

    const restore = state ? state.restore : { center: map.getCenter(), zoom: map.getZoom() };
    if (state) {
      if (state.overlay) { map.removeLayer(state.overlay); }
      state = null;
    }
    const level = dungeon.levels.find(function (l) { return l.data.level === levelNumber; })
      || dungeon.levels[0];
    // The view to come back to is captured BEFORE the fly-in, and survives level
    // switches and re-entries: leaving a dungeon should undo the visit, not leave
    // you hovering over its floor plan at 0.25 m/px.
    state = { dungeon: dungeon, level: level, overlay: null, restore: restore };

    map.closePopup();
    closePicker();
    document.body.classList.add(MODE_CLASS);
    map.getContainer().classList.add(MODE_CLASS);
    ui.name.textContent = dungeon.label;
    paintLevels();
    showLevel();
    map.fitBounds(level.bounds, { padding: [40, 40] });
  }

  function leave() {
    if (!state) { return; }
    const restore = state.restore;
    if (state.overlay) { map.removeLayer(state.overlay); }
    state = null;
    // Back on the surface, and back to the surface's own records.
    setActiveMap(SURFACE_MAP);
    document.body.classList.remove(MODE_CLASS);
    map.getContainer().classList.remove(MODE_CLASS);
    closePicker();
    map.setView(restore.center, restore.zoom);
  }

  /*
   * Walking a passage: the far end is a row on ANOTHER map, so getting there is
   * a map change, not a pan.
   *
   * The link carries canvas coordinates as well as a map id (migration 021), so
   * this works even when the far row is filtered off or missing - the reader
   * still lands where the passage comes out. When the row IS on screen its
   * popup is opened, which is what makes the return trip obvious: the pin you
   * arrive on is the way back.
   *
   * The layer rebuild is flushed rather than awaited: setActiveMap schedules a
   * coalesced rebuild, and this function needs the far pin to exist NOW to open
   * it, in the same click.
   */
  function stepTo(link) {
    const target = L.latLng(link.y, link.x);
    const level = DUNGEON_LINK_RE.exec(link.map);
    if (!level) {
      // The surface. Its own scale is nothing like a floor plan's, so the zoom
      // the dungeon was read at is not kept - fit the dungeon's own high-res
      // surface plate instead, same framing enter() gives a level: fit the
      // bounds for the right zoom, then re-centre on the actual door at that
      // zoom. No surface plate published for this dungeon yet: the old flat
      // zoom, close enough to see the door without landing inside one
      // blurred island tile (0.585 m/px, either style).
      const fromKey = state ? state.dungeon.key : null;
      if (state) {
        if (state.overlay) { map.removeLayer(state.overlay); }
        state = null;
        setActiveMap(SURFACE_MAP);
        document.body.classList.remove(MODE_CLASS);
        map.getContainer().classList.remove(MODE_CLASS);
        closePicker();
      }
      const surfaceBounds = fromKey && surfaceBoundsFor(fromKey);
      if (surfaceBounds) {
        map.fitBounds(surfaceBounds, { padding: [40, 40] });
        map.setView(target, map.getZoom());
      } else {
        map.setView(target, SURFACE_STEP_ZOOM);
      }
    } else {
      // enter() fits the level's bounds, which is the right zoom for a plan and
      // the wrong centre for a door: keep the one, replace the other.
      enter(level[1], Number(level[2]));
      map.setView(target, map.getZoom());
    }
    flushLayerRebuild();
    const far = getMarkers().find(function (mk) {
      return mk._poi && mk._poi.meta && mk._poi.meta.poi_id === link.to;
    });
    if (far) { far.openPopup(); }
  }

  // Swap which manifest is on screen and, if a dungeon is currently open,
  // repaint its CURRENT level under the new style - pan/level/entry state is
  // untouched, only the image. Both manifests share dungeon keys and level
  // numbers (dungeon_plate.py `publish`/`publish-art` write the identical
  // schema), so the same visit carries across the swap.
  function applySet(style, set) {
    activeStyle = style;
    active = set;
    if (!state) { return; }
    const dungeon = active.dungeons[state.dungeon.key];
    const level = dungeon && dungeon.levels.find(function (l) {
      return l.data.level === state.level.data.level;
    });
    if (!dungeon || !level) { return; }
    state.dungeon = dungeon;
    state.level = level;
    showLevel();
  }

  // A style with no plates of its own must never leave the dungeon map blank:
  // fall back to whichever set IS published, silently (loadManifest warns once).
  function switchStyle(style) {
    loadManifest(style).then(function (set) {
      const effectiveStyle = set ? style : STYLES.REALISTIC;
      const effectiveSet = set || manifestCache[STYLES.REALISTIC];
      if (!effectiveSet || effectiveStyle === activeStyle) { return; }
      applySet(effectiveStyle, effectiveSet);
    });
  }
  // Registered before this function's own first await: initStyle() (main.js
  // runs it right after this one) calls style.js's apply() exactly once,
  // unconditionally, as soon as it knows the artwork manifest's availability -
  // that can resolve before or after the fetch below, so subscribing now means
  // it is never missed either way.
  onStyleChange(switchStyle);

  // Artwork is style.js's default, so this normally asks for the artwork plans
  // first and the reader never sees a realistic plan swapped out from under
  // them. REALISTIC is reached two ways: the reader stored that preference, or
  // the artwork manifest is not on disk, which is the fallback below.
  const wantStyle = isArtwork() ? STYLES.ARTWORK : STYLES.REALISTIC;
  let bootSet = await loadManifest(wantStyle);
  let bootStyle = wantStyle;
  if (!bootSet && wantStyle === STYLES.ARTWORK) {
    bootStyle = STYLES.REALISTIC;
    bootSet = await loadManifest(STYLES.REALISTIC);
  }
  if (!bootSet) { return; }
  // A concurrent switchStyle() may already have won this race (see the comment
  // above) - if so, its result stands and this one is dropped.
  if (activeStyle === null) { applySet(bootStyle, bootSet); }
  if (!active) { return; }

  if (!map.getPane(PLATE_PANE)) {
    map.createPane(PLATE_PANE).style.zIndex = 265;
    map.getPane(PLATE_PANE).style.pointerEvents = "none";
  }

  const ui = buildChrome();

  ui.exit.addEventListener("click", leave);
  ui.entry.addEventListener("click", function () {
    openMenu(ui.entry, {
      title: "Dungeon",
      items: active.order.map(function (key) {
        return {
          value: key,
          label: active.dungeons[key].label + " (" + active.dungeons[key].levels.length + " levels)"
        };
      }),
      onPick: function (value) { enter(value); }
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state) { leave(); }
  });

  // The pin IS the door: poi/markers.js asks this for every popup it opens.
  //
  // Surface pins only. A pin on a level map is already inside - offering to
  // open the dungeon there is a button that does nothing (enter() returns
  // early on the dungeon it is already in), and next to a passage's "Go to
  // Level 2" it would read as the alternative to it.
  setDungeonLink({
    resolve: function (poi) {
      if (poi.map && poi.map !== SURFACE_MAP) { return null; }
      const key = poi.dungeon || dungeonKeyOf(poi.meta);
      return key && active.dungeons[key] ? key : null;
    },
    open: enter,
    step: stepTo
  });

  return { enter: enter, leave: leave, step: stepTo, dungeons: active.dungeons };
}
