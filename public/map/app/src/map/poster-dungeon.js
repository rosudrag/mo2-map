/*
 * The dungeon sheet: what "Export Poster" means while you are underground.
 *
 * Exporting the surface from inside a dungeon was the bug this module fixes.
 * dungeonmode.js hides the terrain on purpose - a dungeon is a MODE, and the
 * lit island overworld (0.585 m/px, either style now) reading through a
 * floor plan is exactly what that mode exists to stop - so a poster that
 * quietly re-fetched the surface tiles handed back the one image the reader
 * had just navigated away from.
 *
 * Two products, both composited here:
 *
 *   - ONE LEVEL: the plate you are looking at, at its own native 0.25 m/px.
 *   - ALL LEVELS: one sheet, one panel per level, plus a surface panel showing
 *     the doors. Panels are laid out on a grid and every level panel shares ONE
 *     rectangle and ONE scale - the union of every level's bounds and every
 *     entrance - so a room on Level 1 sits at the same place on the sheet as
 *     the ground above it on Level 2. Fitting each panel to its own level's
 *     bounds would have been tighter and would have made the sheet a lie:
 *     panels at different scales cannot be read against each other, which is
 *     the whole reason to put them on one page.
 *
 * The surface panel is the one place where a wider rectangle is the honest
 * choice. This panel always draws the artwork pyramid (deliberately - a
 * dungeon poster is the illustrated style, not whichever style the live map
 * happens to have active), and the finest it draws from is now 0.585 m/px
 * (tiles-art/v3 - it was 2.34 m/px when SURFACE_CONTEXT below was tuned,
 * a ~9x upscale against a level panel's 0.25 m/px; it is a ~2.3x upscale
 * now, a much smaller gap SURFACE_CONTEXT has not been re-measured against).
 * So it takes the same panel BOX and a wider rectangle (entrances plus the
 * dungeon's own footprint, padded), which lands near the raster's native
 * resolution and answers the question a surface page is actually asked:
 * where on the island is this door. Its true metres-per-pixel is printed in
 * its own caption, and every panel carries its OWN scale bar rather than the
 * sheet carrying one bar that would be wrong for at least one panel on it.
 *
 * Entrances are numbered structurally, from the `poi_id` migration 019 wrote
 * (`dungeon.argkepher.entrance.02` -> "2"), never from the pin's name: the
 * community catalogue supplies names, and two of Sarducaa's doors are named
 * after the dungeon rather than numbered ("Halls of Kepher"). The number is on
 * every panel, so "Entrance 2" means the same door on Level 1, on Level 3 and
 * on the surface page. A door that is not on the level being drawn is not
 * dropped and not moved: it keeps its own position and gets a hollow ring,
 * because "this level has no way out" and "the way out is one storey up" are
 * different facts.
 *
 * WHICH level a door or a room is on is a property of the RECORD, not of this
 * file's geometry: every marker states the map it is on (migration 020), each
 * level IS a map (`level.map`, published by dungeon_plate.py), so a panel's pins
 * are a lookup. The first cut tested each pin against the level's bounding
 * rectangle instead, and since these are stacked storeys of one dungeon whose
 * rectangles overlap almost completely, Yel Keskar level 2 claimed all three
 * surface doors and the boss room from the bottom of the dungeon. A level with no
 * `map` in the manifest is treated as UNKNOWN rather than empty: doors go hollow
 * and interior pins stay off, instead of being guessed onto a floor.
 */
import { mapMeta } from "./meta.js";
import { currentDungeon, fmtDepth } from "./dungeonmode.js";
import { getMarkers, isCatEnabled } from "../poi/state.js";
import { mapOf, SURFACE_MAP } from "./active-map.js";
import { dungeonRole, dungeonKeyOf } from "../poi/markers.js";
import { drawTiles } from "./artwork-raster.js";
import { surfacePlateFor } from "./surfaceplates.js";
import { STYLES } from "./style.js";
import {
  INK, PAPER, clamp, filenameDate, fitPixelCap, drawFrame, drawTitle, drawSubtitle,
  drawCredit, drawCompass, pickScaleBar, drawScaleBar, showProgress, savePng,
  titleSize, subtitleSize
} from "./sheet.js";

// Canvas pixels per metre, and its inverse - the projection constant the
// artwork manifest shares with the realistic one (docs/coordinates.md),
// never a hardcoded number.
const PX_PER_M = mapMeta.world.pxPerMetre;
const M_PER_PX = 1 / PX_PER_M;

// How far past the dungeon the surface panel reaches when NO high-res
// surface plate exists for it yet (dungeon_plate.py: render_dungeon_surface
// / map/surfaceplates.js), as a multiple of the level panels' own rectangle.
// Tuned when the artwork pyramid's native resolution was 2.34 m/px, to stay
// big enough that the pyramid drew near-native instead of upscaled, small
// enough that the doors are still the subject of the picture rather than
// four dots in a desert. The pyramid is 0.585 m/px now (tiles-art/v3, ~2.3x
// upscale at this constant's box rather than the ~9x it was tuned against)
// - NOT re-measured against that; unchanged pending review, not because the
// new number was checked and found still right. When a surface plate DOES
// exist the panel is sized around the plate's own bounds instead - it
// already carries the same apron-plus-feather margin past its entrances
// that this constant approximates for the fallback, so there is nothing
// left for a multiplier to derive.
const SURFACE_CONTEXT = 2.6;

// ---- rectangles (canvas-pixel frame, row 0 at the top) --------------------

/*
 * A manifest `bounds` ([[lat0,lng0],[lat1,lng1]], the map's own CRS) as a
 * top-down canvas rectangle. lat counts UP from the canvas bottom and rows
 * count DOWN from its top, so the two lat values swap as they become rows -
 * the same flip that, written the other way round, put every poster label in
 * the sea (FINDINGS 18e).
 */
function rectOfBounds(h, bounds) {
  return {
    c0: Math.min(bounds[0][1], bounds[1][1]),
    c1: Math.max(bounds[0][1], bounds[1][1]),
    r0: h - Math.max(bounds[0][0], bounds[1][0]),
    r1: h - Math.min(bounds[0][0], bounds[1][0])
  };
}

function unionRects(rects) {
  return rects.reduce(function (a, b) {
    return {
      c0: Math.min(a.c0, b.c0), c1: Math.max(a.c1, b.c1),
      r0: Math.min(a.r0, b.r0), r1: Math.max(a.r1, b.r1)
    };
  });
}

function growRect(rect, px) {
  return { c0: rect.c0 - px, c1: rect.c1 + px, r0: rect.r0 - px, r1: rect.r1 + px };
}

/*
 * Expands `rect` (never crops it) until it matches `aspect` (w/h), then clamps
 * it to the canvas. Clamping can eat one side, so the expansion is re-applied
 * to the opposite side - otherwise a dungeon near the island's edge would get a
 * surface panel whose drawn rectangle no longer matched the box it is drawn in,
 * and the plate registration would slide.
 */
function fitAspect(rect, aspect, canvas) {
  let c0 = rect.c0, c1 = rect.c1, r0 = rect.r0, r1 = rect.r1;
  const w = c1 - c0, h = r1 - r0;
  if (w / h < aspect) {
    const want = h * aspect, add = (want - w) / 2;
    c0 -= add; c1 += add;
  } else {
    const want = w / aspect, add = (want - h) / 2;
    r0 -= add; r1 += add;
  }
  // Slide (never shrink) back inside the canvas.
  if (c0 < 0) { c1 -= c0; c0 = 0; }
  if (c1 > canvas.width) { c0 -= c1 - canvas.width; c1 = canvas.width; }
  if (r0 < 0) { r1 -= r0; r0 = 0; }
  if (r1 > canvas.height) { r0 -= r1 - canvas.height; r1 = canvas.height; }
  return {
    c0: Math.max(0, c0), c1: Math.min(canvas.width, c1),
    r0: Math.max(0, r0), r1: Math.min(canvas.height, r1)
  };
}

// ---- the dungeon's own pins ----------------------------------------------

/*
 * The doors, numbered from `poi_id` and sorted by that number.
 *
 * These are read off the SURFACE map: an entrance is a door in the ground, and
 * that is where the catalogue pins it. The inside twin of each door lives on the
 * level's own map and is drawn by `pinsOnMap` like any other interior pin.
 *
 * Filter state is deliberately ignored here: an entrance is structure on a
 * dungeon sheet, not a category the reader happens to have switched on. Ordinary
 * interior pins DO respect it, exactly like the island poster.
 */
function entrancesOf(key) {
  const out = [];
  getMarkers().forEach(function (mk) {
    const poi = mk._poi;
    if (!poi || dungeonRole(poi.meta) !== "entrance") return;
    if (dungeonKeyOf(poi.meta) !== key) return;
    // The door itself, not its inside twin: the twin's poi_id extends the door's
    // (`…entrance.01.inside`), so dungeonRole matches both and the sheet listed
    // six entrances for a dungeon with three.
    if (mapOf(poi) !== SURFACE_MAP) return;
    const id = String(poi.meta.poi_id);
    const m = /entrance\.(\d+)/.exec(id);
    out.push({
      id: id,
      n: m ? parseInt(m[1], 10) : out.length + 1,
      name: poi.name, lng: poi.lng, lat: poi.lat
    });
  });
  out.sort(function (a, b) { return a.n - b.n; });
  return out;
}

/*
 * Everything the catalogue puts ON one map - i.e. on one dungeon LEVEL.
 *
 * The map is the whole attribution: every record states the map it is on
 * (migration 020), so a level's pins are a lookup, not a geometric guess. The
 * cut before this one tested each pin against the level's bounding rectangle,
 * and since a dungeon's levels are stacked storeys whose rectangles overlap
 * almost completely, Yel Keskar level 2 claimed all three surface doors and the
 * boss room from the bottom of the dungeon.
 *
 * `markerVisible` cannot be used to filter these: it hides everything that is
 * not on the ACTIVE map, and a sheet may draw a level the reader is not standing
 * on. Category and type toggles are applied by hand instead, so hiding a
 * category still hides it on the sheet.
 */
function pinsOnMap(mapId) {
  const out = [];
  getMarkers().forEach(function (mk) {
    const poi = mk._poi;
    if (!poi || poi.map !== mapId) return;
    if (!isCatEnabled(poi.category)) return;
    out.push({
      id: poi.meta && poi.meta.poi_id ? String(poi.meta.poi_id) : poi.id,
      name: poi.name, lng: poi.lng, lat: poi.lat,
      // The surface door this record is the inside face of, when it is one.
      twin: poi.meta && poi.meta.twin ? String(poi.meta.twin) : null,
      entrance: dungeonRole(poi.meta) === "entrance" ||
        (poi.meta && poi.meta.poi_class === "dungeon-entrance-inside"),
      // Carried through for records a panel draws specially by class - a
      // passage end (migration 021) needs its direction and the far end's
      // position, neither of which the flags above capture.
      meta: poi.meta || null
    });
  });
  return out;
}

function dungeonPinOf(key) {
  let found = null;
  getMarkers().forEach(function (mk) {
    const poi = mk._poi;
    if (!poi || found) return;
    if (dungeonRole(poi.meta) === "dungeon" && dungeonKeyOf(poi.meta) === key) {
      found = { name: poi.name, lng: poi.lng, lat: poi.lat };
    }
  });
  return found;
}

// ---- panel furniture ------------------------------------------------------

function drawEntrancePin(ctx, x, y, n, solid, size) {
  const r = size;
  ctx.save();
  ctx.lineWidth = Math.max(1.4, r * 0.22);
  ctx.strokeStyle = INK;
  ctx.fillStyle = solid ? INK : PAPER;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = solid ? PAPER : INK;
  ctx.font = '700 ' + Math.round(r * 1.35) + 'px "Modern Antiqua", serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), x, y + r * 0.06);
  ctx.restore();
}

/*
 * The label-placement half of an interior pin: `taken` is the list of label
 * boxes already drawn on this panel, and a label that would land on one is
 * pushed down a line until it is clear. Sarducaa's gold and silver ingot
 * caches sit five metres apart, and at 0.25 m/px their two names printed
 * straight through each other into an unreadable smear. Shared by every
 * marker shape a panel draws (hollow dot, passage chevron) so two kinds of
 * pin can never still print through one another's names.
 */
function drawPinLabel(ctx, x, y, r, name, fontPx, taken) {
  if (!name) return;
  ctx.fillStyle = INK;
  ctx.font = fontPx + 'px "Modern Antiqua", serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const lx = x + r * 1.9;
  const w = ctx.measureText(name).width;
  let ly = y;
  if (taken) {
    const step = fontPx * 1.35;
    for (let tries = 0; tries < 12; tries++) {
      const clash = taken.some(function (b) {
        return lx < b.x1 && lx + w > b.x0 && ly - fontPx * 0.6 < b.y1 && ly + fontPx * 0.6 > b.y0;
      });
      if (!clash) break;
      ly += step;
    }
    taken.push({ x0: lx, x1: lx + w, y0: ly - fontPx * 0.6, y1: ly + fontPx * 0.6 });
    // A pushed label needs a leader back to its own dot, or it reads as a
    // caption for whatever it ended up next to.
    if (ly !== y) {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, fontPx * 0.06);
      ctx.beginPath();
      ctx.moveTo(x + r * 1.1, y);
      ctx.lineTo(lx - fontPx * 0.25, ly);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  ctx.fillText(name, lx, ly);
}

/*
 * An interior pin and its name.
 */
function drawHollowDot(ctx, x, y, r, name, fontPx, taken) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = PAPER;
  ctx.lineWidth = Math.max(1.2, r * 0.34);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawPinLabel(ctx, x, y, r, name, fontPx, taken);
  ctx.restore();
}

/*
 * The filled triangle alone, pointing the way a passage goes - apex down for
 * the way in, apex up for the way back. Split out from `drawPassageSymbol` so
 * the legend can draw the exact glyph a panel does, rather than a description
 * of it.
 */
function drawChevron(ctx, x, y, r, going) {
  ctx.save();
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.beginPath();
  if (going === "up") {
    ctx.moveTo(x, y - r * 0.95);
    ctx.lineTo(x + r, y + r * 0.75);
    ctx.lineTo(x - r, y + r * 0.75);
  } else {
    ctx.moveTo(x, y + r * 0.95);
    ctx.lineTo(x + r, y - r * 0.75);
    ctx.lineTo(x - r, y - r * 0.75);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/*
 * A passage end: the chevron, a short leader aimed at the OTHER end (from
 * `meta.link`, which is in the same canvas frame as everything else on the
 * sheet, so the bearing is real), and the name through the same label path an
 * interior dot uses. The leader is deliberately a short stub rather than a
 * line to the far point - the far point is very often off this panel
 * entirely, on another level's own rectangle, so drawing a line to it would
 * be drawing a route the sheet cannot actually show.
 */
function drawPassageSymbol(ctx, x, y, r, going, fromLng, fromLat, toLng, toLat, name, fontPx, taken) {
  const dc = toLng - fromLng;
  const dr = fromLat - toLat; // row-space delta: lat counts up, rows count down
  const dist = Math.hypot(dc, dr) || 1;
  const ux = dc / dist, uy = dr / dist;
  const stub = r * 2.2;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = Math.max(1.2, r * 0.26);
  ctx.beginPath();
  ctx.moveTo(x + ux * r * 1.15, y + uy * r * 1.15);
  ctx.lineTo(x + ux * (r * 1.15 + stub), y + uy * (r * 1.15 + stub));
  ctx.stroke();
  ctx.restore();

  drawChevron(ctx, x, y, r, going);

  ctx.save();
  drawPinLabel(ctx, x, y, r, name, fontPx, taken);
  ctx.restore();
}

/*
 * The level's own footprint inside the shared rectangle, as a dashed rule.
 *
 * With every panel drawn on the union of all levels, a small level would
 * otherwise float in blank paper with nothing saying whether the emptiness is
 * unrendered or simply not part of that level. The dashed rule is the answer:
 * inside it is this level, outside it is another storey's ground.
 */
function drawFootprint(ctx, x, y, w, h, dash) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(1, dash * 0.22);
  ctx.setLineDash([dash, dash * 0.8]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawPanelCaption(ctx, x, y, w, title, detail, titlePx) {
  ctx.save();
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = '700 ' + titlePx + 'px "Modern Antiqua", serif';
  ctx.fillText(title, x, y);
  if (detail) {
    ctx.globalAlpha = 0.82;
    ctx.font = Math.round(titlePx * 0.62) + 'px "Modern Antiqua", serif';
    ctx.textAlign = "right";
    ctx.fillText(detail, x + w, y);
  }
  ctx.restore();
}

const LEGEND_NOTE = [
  "A hollow ring is a door on ANOTHER storey, drawn at its own",
  "position. Which doors and rooms belong to which level comes from",
  "the game's own package grouping, never from the level's outline:",
  "these storeys overlap in plan. Dashed rule = this level's own",
  "footprint; all level panels share one frame and one scale.",
  "A filled chevron is a passage to another storey: it points the",
  "way that passage goes, down to descend and up to climb back."
];

/*
 * How tall the key will be, before anything is drawn - the bottom margin has to
 * be sized for it when there is no spare grid cell to put it in. Measured with
 * the same arithmetic drawLegend uses, so the two cannot drift.
 */
export function legendHeight(rows, fontPx) {
  return Math.round(fontPx * (2.0 + rows * 1.75 + 0.5 + LEGEND_NOTE.length * 1.25));
}

/*
 * The key: every door's number and the name the catalogue gives it, what a
 * hollow marker means, and - when the sheet has any - what a passage chevron
 * means. Drawn into a spare grid cell when the layout leaves one (three
 * panels on a 2x2 grid), otherwise into the bottom margin.
 */
function drawLegend(ctx, x, y, w, entrances, fontPx, heading, passageCount) {
  ctx.save();
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let cy = y;
  ctx.font = '700 ' + Math.round(fontPx * 1.15) + 'px "Modern Antiqua", serif';
  ctx.fillText(heading, x, cy);
  cy += fontPx * 2.0;
  const r = fontPx * 0.78;
  entrances.forEach(function (e) {
    drawEntrancePin(ctx, x + r, cy, e.n, true, r);
    ctx.fillStyle = INK;
    ctx.font = fontPx + 'px "Modern Antiqua", serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Entrance " + e.n + (e.name ? " \u00b7 " + e.name : ""), x + r * 3.2, cy);
    cy += fontPx * 1.75;
  });
  if (passageCount) {
    drawChevron(ctx, x + r * 0.55, cy, r * 0.6, "down");
    drawChevron(ctx, x + r * 1.75, cy, r * 0.6, "up");
    ctx.fillStyle = INK;
    ctx.font = fontPx + 'px "Modern Antiqua", serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Passage \u00b7 down to the next level, up back to this one", x + r * 3.2, cy);
    cy += fontPx * 1.75;
  }
  cy += fontPx * 0.5;
  ctx.globalAlpha = 0.82;
  ctx.font = Math.round(fontPx * 0.86) + 'px "Modern Antiqua", serif';
  LEGEND_NOTE.forEach(function (line) {
    ctx.fillText(line, x, cy);
    cy += fontPx * 1.25;
  });
  ctx.restore();
  return cy - y;
}

// ---- the sheet ------------------------------------------------------------

function gridFor(n) {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n <= 4) return { cols: 2, rows: Math.ceil(n / 2) };
  return { cols: 3, rows: Math.ceil(n / 3) };
}

async function loadPlate(url) {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error("plate " + url + ": HTTP " + res.status);
  return await createImageBitmap(await res.blob());
}

/*
 * Where every panel lands, for a given output scale (output px per canvas px).
 *
 * Every margin is DERIVED from what will be drawn in it, not from a fraction of
 * the panel that happens to look about right: the top margin from the title
 * block's own two font sizes, the bottom margin from the key's measured height
 * when there is no spare grid cell to hold it. Both were fractions once, and
 * both were wrong on the first real sheet - a subtitle drawn through the frame's
 * top rule and a third entrance clipped off the bottom edge.
 *
 * Called in a loop against the pixel cap, so the whole layout is re-derived from
 * one scale rather than patched, which is what keeps the second pass consistent
 * with the first.
 */
function layout(scale, rect, panelCount, legendRows) {
  const panelW = Math.max(1, Math.round((rect.c1 - rect.c0) * scale));
  const panelH = Math.max(1, Math.round((rect.r1 - rect.r0) * scale));
  const grid = gridFor(panelCount);
  const capPx = clamp(Math.round(panelH * 0.085), 22, 92);   // caption strip above each panel
  const gutter = clamp(Math.round(panelW * 0.035), 18, 96);
  const side = clamp(Math.round(panelW * 0.05), 30, 130);
  const gridW = grid.cols * panelW + (grid.cols - 1) * gutter;

  // The title block, at the size it will actually be drawn at.
  const titlePx = titleSize(gridW + side * 2);
  const subPx = subtitleSize(gridW + side * 2);
  const titleBaseline = Math.round(titlePx * 1.35);
  const subY = titleBaseline + Math.round(subPx * 1.9);
  const top = subY + Math.round(subPx * 1.2) + Math.round(capPx * 1.35);

  const legendFont = clamp(Math.round(panelW * 0.017), 11, 30);
  const marginLegend = legendRows ? legendHeight(legendRows, Math.round(legendFont * 0.8)) : 0;
  const bottom = clamp(Math.round(panelW * 0.07), 56, 200) + marginLegend;
  const cellH = panelH + capPx;
  return {
    panelW: panelW, panelH: panelH, capPx: capPx, gutter: gutter,
    side: side, top: top, bottom: bottom, grid: grid, cellH: cellH,
    titlePx: titlePx, subPx: subPx, titleBaseline: titleBaseline, subY: subY,
    legendFont: legendFont, gridW: gridW,
    gridH: grid.rows * cellH + (grid.rows - 1) * gutter,
    sheetW: side * 2 + gridW,
    sheetH: top + bottom + grid.rows * cellH + (grid.rows - 1) * gutter
  };
}

/*
 * `mode` is "level" (the open level alone) or "all" (every level plus the
 * surface panel). `artwork` is the tiles-art manifest, needed for the surface
 * panel's raster and for the canvas frame both products register against.
 */
export async function exportDungeon(artwork, mode) {
  const view = currentDungeon();
  if (!view) return; // caller checks too; a mode change mid-menu lands here

  const canvas = artwork.canvas;
  const levels = mode === "level" ? [view.level] : view.levels;
  const entrances = entrancesOf(view.key);
  const dungeonPin = dungeonPinOf(view.key);
  const metresPerPx = levels[0].metresPerPx || 0.25;

  // What is on each level, fetched once up front: the passage count has to
  // be known before the layout pass sizes the legend, and the per-panel loop
  // below reuses these same lists instead of asking the catalogue twice.
  const levelPinsByLevel = levels.map(function (l) { return l.map ? pinsOnMap(l.map) : null; });
  const passageCount = levelPinsByLevel.reduce(function (n, pins) {
    if (!pins) return n;
    return n + pins.filter(function (p) { return p.meta && p.meta.poi_class === "dungeon-passage"; }).length;
  }, 0);

  // The shared frame: every level's bounds, plus every door, so a door is never
  // off the paper on the level it belongs to.
  const levelRects = levels.map(function (l) { return rectOfBounds(canvas.height, l.bounds); });
  let shared = unionRects(levelRects);
  entrances.forEach(function (e) {
    shared = unionRects([shared, { c0: e.lng, c1: e.lng, r0: canvas.height - e.lat, r1: canvas.height - e.lat }]);
  });
  shared = growRect(shared, Math.max(4, (shared.c1 - shared.c0) * 0.02));

  const wantSurface = mode !== "level" && entrances.length > 0;
  const panelCount = levels.length + (wantSurface ? 1 : 0);
  const grid = gridFor(panelCount);
  const spare = grid.cols * grid.rows - panelCount;

  // Native plate detail: output pixels per canvas pixel that reproduces one
  // plate pixel per sheet pixel (0.25 m/px against the canvas's 4.68 m/px).
  const nativeScale = (1 / metresPerPx) / PX_PER_M;
  const legendRows = entrances.length && spare === 0 ? entrances.length + (passageCount ? 1 : 0) : 0;

  // Margins clamp, so shrinking the panels does not shrink the sheet by the
  // same factor and one pass can still land over the cap - the first four-panel
  // sheet came out at 45.8 MP against a 45 MP ceiling. Re-derive until it fits,
  // announcing the step-down once.
  let scale = nativeScale;
  let L = layout(scale, shared, panelCount, legendRows);
  for (let pass = 0; pass < 4; pass++) {
    const shrink = fitPixelCap(L.sheetW, L.sheetH, pass === 0 ? "dungeon sheet" : null);
    if (shrink === 1) break;
    scale *= shrink;
    L = layout(scale, shared, panelCount, legendRows);
  }

  const sheet = document.createElement("canvas");
  sheet.width = L.sheetW;
  sheet.height = L.sheetH;
  const ctx = sheet.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, L.sheetW, L.sheetH);

  await document.fonts.ready;

  const cellAt = function (i) {
    const col = i % L.grid.cols;
    const row = Math.floor(i / L.grid.cols);
    return {
      x: L.side + col * (L.panelW + L.gutter),
      y: L.top + row * (L.cellH + L.gutter)
    };
  };

  const captionPx = clamp(Math.round(L.capPx * 0.52), 12, 40);
  const pinR = clamp(Math.round(L.panelW * 0.011), 7, 26);
  const barFont = clamp(Math.round(L.panelW * 0.013), 10, 26);
  let failedPlates = 0;

  // ---- level panels ----
  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i];
    const cell = cellAt(i);
    const px = cell.x;
    const py = cell.y + L.capPx;
    const lr = levelRects[i];

    showProgress("Drawing level " + lvl.level + "\u2026 (" + (i + 1) + "/" + levels.length + ")");

    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, L.panelW, L.panelH);
    ctx.clip();

    // A dungeon plate is one image (dungeon_plate.py), so no tiling: fetch it
    // and place it by its own bounds inside the shared frame.
    const dx = px + (lr.c0 - shared.c0) * scale;
    const dy = py + (lr.r0 - shared.r0) * scale;
    const dw = (lr.c1 - lr.c0) * scale;
    const dh = (lr.r1 - lr.r0) * scale;
    try {
      const bmp = await loadPlate(lvl.file);
      ctx.drawImage(bmp, dx, dy, dw, dh);
      bmp.close();
    } catch (err) {
      failedPlates++;
      console.warn("dungeon plate failed:", err && err.message);
    }
    drawFootprint(ctx, dx, dy, dw, dh, Math.max(4, L.panelW * 0.012));

    // What is on THIS level: the records the catalogue puts on this level's own
    // map (migration 020), fetched up front alongside every other level's. A
    // door counts as being on the level when its inside twin is on that map -
    // the twin carries `meta.twin` naming the surface door it belongs to, so
    // the sheet never has to parse an id. A manifest with no `map` for the
    // level is UNKNOWN, not empty: doors are then drawn hollow (position
    // known, storey not) and interior pins stay off rather than being guessed
    // onto a floor.
    const levelPins = levelPinsByLevel[i];
    const known = levelPins !== null;

    if (known) {
      // One list per panel: labels may only be pushed clear of labels on the
      // same sheet of paper.
      const labels = [];
      levelPins.forEach(function (p) {
        if (p.entrance) return; // doors are drawn below, numbered
        const sx = px + (p.lng - shared.c0) * scale;
        const sy = py + (canvas.height - p.lat - shared.r0) * scale;
        if (p.meta && p.meta.poi_class === "dungeon-passage" && p.meta.link) {
          drawPassageSymbol(
            ctx, sx, sy, pinR * 0.62, p.meta.going,
            p.lng, p.lat, p.meta.link.x, p.meta.link.y,
            p.name, captionPx * 0.82, labels
          );
          return;
        }
        drawHollowDot(ctx, sx, sy, pinR * 0.62, p.name, captionPx * 0.82, labels);
      });
    }

    const doorHere = function (e) {
      return known && levelPins.some(function (p) { return p.twin === e.id; });
    };

    entrances.forEach(function (e) {
      // Always its TRUE position - the ring, not the placement, is what says
      // "another storey". An earlier cut clamped a foreign door to the edge of
      // this level's footprint to point at it, which displaced doors whose
      // coordinates already sit inside the footprint (every door at Yel Keskar
      // level 2) and so invented a position to convey information the ring and
      // the caption already carry.
      drawEntrancePin(
        ctx,
        px + (e.lng - shared.c0) * scale,
        py + (canvas.height - e.lat - shared.r0) * scale,
        e.n, doorHere(e), pinR
      );
    });
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(1.2, L.panelW * 0.0016);
    ctx.strokeRect(px + 0.5, py + 0.5, L.panelW, L.panelH);
    ctx.restore();

    const onThis = entrances.filter(doorHere).map(function (e) { return e.n; });
    const doors = !entrances.length ? ""
      : !known ? "doors not attributed"
        : onThis.length ? "doors " + onThis.join(", ")
          : "no door on this level";
    const passagesHere = known ? levelPins.filter(function (p) {
      return p.meta && p.meta.poi_class === "dungeon-passage";
    }).length : 0;
    drawPanelCaption(
      ctx, px, cell.y + L.capPx - Math.round(captionPx * 0.5), L.panelW,
      "Level " + lvl.level,
      [fmtDepth(lvl.depthM), lvl.sections ? lvl.sections + " sections" : "", doors,
        passagesHere ? passagesHere + (passagesHere === 1 ? " passage" : " passages") : ""]
        .filter(Boolean).join(" \u00b7 "),
      captionPx
    );

    const bar = pickScaleBar(L.panelW, PX_PER_M * scale);
    drawScaleBar(ctx, px + Math.round(L.panelW * 0.03), py + L.panelH - Math.round(L.panelH * 0.06), bar.px, bar.label, barFont);
  }

  // ---- surface panel ----
  let tileStats = null;
  let surfacePlate = null;
  let surfaceBitmap = null;
  if (wantSurface) {
    // Always the artwork plate, matching `artwork` itself: the surface panel
    // has never drawn the reader's live map style (its own comment at the
    // top of this file), only the artwork pyramid, so the plate over it is
    // the same style for the same reason.
    //
    // Loaded HERE, before the sizing decision below, not at draw time: a
    // manifest entry existing is not the same guarantee as its image
    // actually fetching and decoding, and the old version of this code drew
    // the panel already sized and captioned for a plate, then silently drew
    // nothing when `loadPlate` failed - a caption claiming "the game's own
    // surface geometry" over a panel that was, in the event, plain artwork
    // tiles. `surfacePlate` staying null on any failure here is what keeps
    // the sizing, the draw and the caption below all agreeing with each
    // other and with what actually got drawn.
    const candidate = await surfacePlateFor(view.key, STYLES.ARTWORK);
    if (candidate) {
      try {
        surfaceBitmap = await loadPlate(candidate.file);
        surfacePlate = candidate;
      } catch (err) {
        failedPlates++;
        console.warn("surface plate failed:", err && err.message);
      }
    }
    const cell = cellAt(levels.length);
    const px = cell.x;
    const py = cell.y + L.capPx;
    const aspect = L.panelW / L.panelH;
    let srect;
    if (surfacePlate) {
      // The plate already carries its own apron-plus-feather margin past the
      // entrances (town_plate.py's APRON_M/APRON_FEATHER_M, the same machinery
      // a town plate uses), so the panel is sized around the plate's OWN
      // bounds rather than a multiple of `shared` - union only as a guard
      // against a level or a door somehow sitting outside it.
      srect = unionRects([shared, rectOfBounds(canvas.height, surfacePlate.bounds)]);
    } else {
      // No surface plate published for this dungeon yet, or its image failed
      // to load: the old fallback, sized so the pyramid draws near its own
      // native resolution.
      srect = growRect(shared, ((shared.c1 - shared.c0) * (SURFACE_CONTEXT - 1)) / 2);
    }
    srect = fitAspect(srect, aspect, canvas);
    const sscale = L.panelW / (srect.c1 - srect.c0);

    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, L.panelW, L.panelH);
    ctx.clip();
    tileStats = await drawTiles(ctx, artwork, srect, px, py, sscale, function (done, total) {
      showProgress("Surface tiles\u2026 " + done + "/" + Math.max(total, done));
    });

    if (surfacePlate) {
      // Over the pyramid, exactly like a level panel draws its own dungeon
      // plate above. The plate's own alpha feather (built into the PNG) is
      // what blends it into the tiles just drawn - nothing here composites
      // an edge by hand. Already loaded and verified above; drawing it here
      // cannot fail on the network/decode the way loading can.
      const prect = rectOfBounds(canvas.height, surfacePlate.bounds);
      const pdx = px + (prect.c0 - srect.c0) * sscale;
      const pdy = py + (prect.r0 - srect.r0) * sscale;
      const pdw = (prect.c1 - prect.c0) * sscale;
      const pdh = (prect.r1 - prect.r0) * sscale;
      ctx.drawImage(surfaceBitmap, pdx, pdy, pdw, pdh);
      surfaceBitmap.close();
    }

    // The dungeon's own footprint, so the doors are read against the ground the
    // levels above actually occupy.
    drawFootprint(
      ctx,
      px + (shared.c0 - srect.c0) * sscale, py + (shared.r0 - srect.r0) * sscale,
      (shared.c1 - shared.c0) * sscale, (shared.r1 - shared.r0) * sscale,
      Math.max(4, L.panelW * 0.012)
    );

    if (dungeonPin) {
      drawHollowDot(
        ctx,
        px + (dungeonPin.lng - srect.c0) * sscale,
        py + (canvas.height - dungeonPin.lat - srect.r0) * sscale,
        pinR * 0.7, dungeonPin.name, captionPx * 0.9
      );
    }
    entrances.forEach(function (e) {
      drawEntrancePin(
        ctx,
        px + (e.lng - srect.c0) * sscale,
        py + (canvas.height - e.lat - srect.r0) * sscale,
        e.n, true, pinR
      );
    });
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(1.2, L.panelW * 0.0016);
    ctx.strokeRect(px + 0.5, py + 0.5, L.panelW, L.panelH);
    ctx.restore();

    // The source resolution is printed next to the drawn one on purpose: a
    // caption that hid what this panel is actually made of would be selling
    // an upscale as a survey, whichever source it is this time.
    drawPanelCaption(
      ctx, px, cell.y + L.capPx - Math.round(captionPx * 0.5), L.panelW,
      "Surface \u2014 the doors",
      (surfacePlate
        ? (M_PER_PX / sscale).toFixed(2) + " m/px, the game's own surface geometry"
        : (M_PER_PX / sscale).toFixed(2) + " m/px, from " +
          (M_PER_PX / Math.pow(2, artwork.maxZoom)).toFixed(2) + " m/px tiles") +
        " \u00b7 " + (entrances.length === 1 ? "1 entrance" : entrances.length + " entrances"),
      captionPx
    );

    const bar = pickScaleBar(L.panelW, PX_PER_M * sscale);
    drawScaleBar(ctx, px + Math.round(L.panelW * 0.03), py + L.panelH - Math.round(L.panelH * 0.06), bar.px, bar.label, barFont);
  }

  // ---- frame, title, key ----
  const frameX = L.side - Math.round(L.gutter * 0.5);
  const frameY = L.top - Math.round(L.capPx * 1.15);
  drawFrame(
    ctx, frameX, frameY,
    L.gridW + Math.round(L.gutter), L.gridH + Math.round(L.capPx * 1.15) + Math.round(L.gutter * 0.5),
    clamp(Math.round(L.side * 0.32), 8, 30)
  );

  drawTitle(ctx, L.sheetW / 2, L.titleBaseline, L.sheetW, view.label.toUpperCase(), L.titlePx);
  drawSubtitle(
    ctx, L.sheetW / 2, L.subY, L.sheetW,
    (mode === "level"
      ? "Level " + view.level.level + " of " + view.levels.length
      : levels.length + (levels.length === 1 ? " level" : " levels") + " and the surface above") +
    " \u00b7 " + metresPerPx.toFixed(2) + " m/px plans \u00b7 " +
    (entrances.length === 1 ? "one entrance" : entrances.length + " entrances"),
    L.subPx
  );

  if (entrances.length) {
    if (spare > 0) {
      const cell = cellAt(panelCount);
      drawLegend(ctx, cell.x + Math.round(L.panelW * 0.06), cell.y + L.capPx + Math.round(L.panelH * 0.1),
        L.panelW, entrances, L.legendFont, "Entrances", passageCount);
    } else {
      const fontPx = Math.round(L.legendFont * 0.8);
      drawLegend(ctx, L.side, L.top + L.gridH + Math.round(L.capPx * 0.9) + fontPx,
        L.gridW, entrances, fontPx, "Entrances", passageCount);
    }
  }

  const compassR = clamp(Math.round(L.capPx * 0.5), 14, 40);
  drawCompass(ctx, L.side + L.gridW - compassR, L.top + L.gridH + Math.round(L.capPx * 1.1) + compassR, compassR);
  drawCredit(ctx, L.sheetW / 2, L.sheetH - Math.round(L.capPx * 0.5), view.label + " dungeon plans");

  const slug = mode === "level" ? view.key + "-level-" + view.level.level : view.key + "-all-levels";
  const filename = await savePng(sheet, mapMeta.id + "-" + slug + "-" + filenameDate() + ".png");
  return {
    filename: filename,
    failedPlates: failedPlates,
    failedTiles: tileStats ? tileStats.failed : 0,
    size: [L.sheetW, L.sheetH]
  };
}
