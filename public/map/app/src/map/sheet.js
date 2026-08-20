/*
 * The paper, and everything drawn on it that is not the map itself.
 *
 * Two exports composite sheets now - the island poster (map/poster.js) and the
 * dungeon sheet (map/poster-dungeon.js) - and both want the same furniture: a
 * double rule with corner ornaments, an old-style title, a derived scale bar, a
 * compass rose, a credit line, the progress pill, the pixel cap and the
 * download. This module owns exactly that, so neither export owns a private
 * copy of a scale bar that can drift from the other's.
 *
 * Nothing here knows what a tile or a dungeon is: callers pass output pixels.
 * The one rule this module does enforce is the pixel cap, because both callers
 * can ask for a sheet big enough to kill the tab.
 */
import { toast } from "../ui/toast.js";

export const INK = "#3A2C1E";
export const PAPER = "#ECDEC0";

/*
 * Total OUTPUT pixels a single export may produce. A 2x whole-island export at
 * native zoom 1 is 10240x7158 (~73 MP) - big enough that canvas allocation and
 * PNG encoding can stall or crash an embedded web view tab. 45 MP comfortably clears the
 * whole-island 1x poster (~18.3 MP, the common case), a single native dungeon
 * level (~18.5 MP at 0.25 m/px) and generous current-view exports, while
 * anything larger gets stepped DOWN rather than refused: a four-panel dungeon
 * sheet at native plate resolution wants ~48 MP and lands at a still-crisp 45.
 */
export const PIXEL_CAP = 45_000_000;

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// yyyymmdd, for the filename the brief specifies verbatim.
export function filenameDate() {
  const d = new Date();
  return String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate());
}

// Plain ISO 8601, for the credit line a human reads.
export function humanDate() {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

/*
 * How much a requested sheet has to shrink to fit PIXEL_CAP, as a multiplier in
 * (0, 1]. Returns 1 when it already fits, so callers can multiply
 * unconditionally. `label` names the thing being shrunk in the toast; passing
 * null suppresses the toast (a caller that shrinks in two stages should only
 * say so once).
 */
export function fitPixelCap(w, h, label) {
  const requested = w * h;
  if (requested <= PIXEL_CAP) return 1;
  const shrink = Math.sqrt(PIXEL_CAP / requested);
  if (label) {
    toast(
      "That " + label + " is huge \u2014 stepping down to " +
      Math.round(w * shrink) + "\u00d7" + Math.round(h * shrink) +
      " (" + (PIXEL_CAP / 1e6).toFixed(0) + " MP cap) to keep the tab responsive.",
      "warn"
    );
  }
  return shrink;
}

// ---- cartouche ------------------------------------------------------------

export function drawBorder(ctx, x, y, w, h) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, w * 0.0016);
  const inset = ctx.lineWidth * 3.5;
  ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
  ctx.restore();
}

export function drawCornerOrnament(ctx, cx, cy, size) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.beginPath();
  ctx.moveTo(cx - size, cy);
  ctx.lineTo(cx, cy - size);
  ctx.lineTo(cx + size, cy);
  ctx.lineTo(cx, cy + size);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The double rule plus an ornament on each of its four corners. */
export function drawFrame(ctx, x, y, w, h, ornSize) {
  drawBorder(ctx, x, y, w, h);
  [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(function (p) {
    drawCornerOrnament(ctx, p[0], p[1], ornSize);
  });
}

/*
 * Title and subtitle.
 *
 * `sizePx` exists because a caller that RESERVES vertical space for this block
 * has to draw it at the size it reserved for. The dungeon sheet measures its
 * top margin from titleSize()/subtitleSize() before it knows the final sheet
 * width, and letting the two derive independently is what put a subtitle
 * straight through the frame's top rule.
 */
export function titleSize(sheetWidth) {
  return clamp(Math.round(sheetWidth * 0.05), 22, 72);
}

export function subtitleSize(sheetWidth) {
  return clamp(Math.round(sheetWidth * 0.014), 12, 26);
}

export function drawTitle(ctx, centerX, baselineY, sheetWidth, text, sizePx) {
  ctx.save();
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const size = sizePx || titleSize(sheetWidth);
  ctx.font = '700 ' + size + 'px "Modern Antiqua", serif';
  ctx.fillText(text, centerX, baselineY);
  ctx.restore();
  return size;
}

/** The line under a title: what this sheet is, in the map's own numbers. */
export function drawSubtitle(ctx, centerX, y, sheetWidth, text, sizePx) {
  ctx.save();
  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.86;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const size = sizePx || subtitleSize(sheetWidth);
  ctx.font = size + 'px "Modern Antiqua", serif';
  ctx.fillText(text, centerX, y);
  ctx.restore();
  return size;
}

export function drawCredit(ctx, centerX, y, text) {
  ctx.save();
  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.82;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '11px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(
    (text ? text + " \u2014 " : "") +
    "Rendered from the game's own cooked data \u2014 " + humanDate(),
    centerX, y
  );
  ctx.restore();
}

const NICE_M = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
const NICE_KM = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];

/*
 * Picks the largest "nice" round distance whose bar fits a target on-sheet
 * width, then derives the drawn length FROM that value - so the label and the
 * bar can never disagree. `pxPerMetreAtOutput` comes from the caller's own
 * projection maths (mapMeta.world.pxPerMetre times the output scale),
 * never from a hardcoded pixel length.
 *
 * Dungeon panels are 0.25 m/px plans a few hundred metres across, where every
 * NICE_KM step but the first is off the sheet and "0.5 km" spans a whole level;
 * hence the metre ladder, chosen when kilometres cannot land a bar inside the
 * target width.
 */
export function pickScaleBar(width, pxPerMetreAtOutput) {
  const targetPx = clamp(width * 0.16, 90, 280);
  if (NICE_KM[0] * 1000 * pxPerMetreAtOutput > targetPx) {
    let m = NICE_M[0];
    for (let i = 0; i < NICE_M.length; i++) {
      if (NICE_M[i] * pxPerMetreAtOutput <= targetPx) m = NICE_M[i]; else break;
    }
    return { label: m + " m", px: m * pxPerMetreAtOutput };
  }
  let km = NICE_KM[0];
  for (let i = 0; i < NICE_KM.length; i++) {
    if (NICE_KM[i] * 1000 * pxPerMetreAtOutput <= targetPx) km = NICE_KM[i]; else break;
  }
  return { label: km + " km", px: km * 1000 * pxPerMetreAtOutput };
}

export function drawScaleBar(ctx, x, y, barPx, label, fontPx) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 1.5;
  const size = fontPx || 12;
  const barH = Math.max(5, Math.round(size * 0.66));
  ctx.strokeRect(x + 0.5, y + 0.5, barPx, barH);
  const segments = 4;
  for (let i = 0; i < segments; i++) {
    if (i % 2 === 0) ctx.fillRect(x + (barPx / segments) * i, y, barPx / segments, barH);
  }
  ctx.font = size + 'px "Modern Antiqua", serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(label, x, y + barH + Math.round(size * 0.4));
  ctx.restore();
}

export function drawCompass(ctx, cx, cy, r) {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = Math.max(1.25, r * 0.05);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  // North spike, prominent.
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 1.2);
  ctx.lineTo(cx - r * 0.22, cy - r * 0.1);
  ctx.lineTo(cx + r * 0.22, cy - r * 0.1);
  ctx.closePath();
  ctx.fill();
  // E/S/W spikes, shorter.
  [[1, 0], [0, 1], [-1, 0]].forEach(function (dir) {
    const dx = dir[0], dy = dir[1];
    ctx.beginPath();
    ctx.moveTo(cx + dx * r * 0.82, cy + dy * r * 0.82);
    ctx.lineTo(cx + dy * r * 0.14 - dx * r * 0.06, cy - dx * r * 0.14 + dy * r * 0.06);
    ctx.lineTo(cx - dy * r * 0.14 - dx * r * 0.06, cy + dx * r * 0.14 + dy * r * 0.06);
    ctx.closePath();
    ctx.fill();
  });
  ctx.font = '700 ' + Math.round(r * 0.55) + 'px "Modern Antiqua", serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", cx, cy - r * 1.55);
  ctx.restore();
}

// ---- progress pill --------------------------------------------------------

let progressEl = null;
function progressNode() {
  if (!progressEl) {
    progressEl = document.createElement("div");
    progressEl.id = "poster-progress";
    document.body.appendChild(progressEl);
  }
  return progressEl;
}

export function showProgress(text) {
  const el = progressNode();
  el.textContent = text;
  el.classList.add("show");
}

export function hideProgress() {
  if (progressEl) progressEl.classList.remove("show");
}

// ---- the download ---------------------------------------------------------

/*
 * Hands the finished canvas to the browser as a PNG download. The <a> is
 * created, clicked and removed here; the canvas is the caller's local and is
 * garbage once it returns, so there is nothing else to tear down.
 */
export async function savePng(canvas, filename) {
  const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
  if (!blob) throw new Error("canvas.toBlob produced no data");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
}
