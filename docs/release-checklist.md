# Release checklist — Sarducaa public launch

Snapshot of what has been checked, how, and what has not, as of this
session's full arc: map UI (search/filter correctness, discovery popups,
first-run legend, cluster bubble legibility, credit line, focus visibility,
keyboard tab order), an asset-manifest consistency test suite, and — most
recently — a round of terrain/plate render fixes and republish from the
offline extraction pipeline (foliage colour, display gamma, a misbound
normal map, dungeon fallback-material shading, and dungeon-surface entrance
legibility). Grouped by evidence strength, not by feature, because the
honest gap here is a *tool* gap (a browser became unavailable mid-session
and stayed unavailable through the rest of it, reconfirmed just now), not a
feature gap — several fixes are correct by computation, by inspection of
the built artifact, or by the owner's own direct look at the rendered
output images, but have not been seen through this session's browser tool.

## Automated gates — always current

Re-run at every step of this session; both green as of the last commit.

- `node bin/build.mjs --verify` — `dist/` matches `src/` and `index.html`'s
  `?v=` stamps are current.
- `node --test test/*.test.mjs` — 78/78 passing: coordinate fit, static-file
  server headers/caching, every snapshot-validator contract check, and (new
  this round) 27 asset-manifest consistency checks — every published plate
  and tile manifest parses, names files that exist on disk at the path the
  page actually fetches, leaves no orphaned image behind, and agrees with
  its realistic/artwork sibling on which keys (and, for dungeons, which
  levels) it publishes.

## Verified live — actually rendered in a browser, screenshotted

True for everything below at the time it was built, using headless Chromium
via this session's browser tool. The tool became unavailable partway
through the session (confirmed by two independent checks, including a
subagent run in a fresh session, and reconfirmed with a third attempt just
now while writing this checklist); everything after that point is in the
next two sections.

- Landing page (`public/index.html`) at 1280×800 and 375×812 — no horizontal
  overflow, cards and footer render and wrap correctly.
- Sarducaa map default view at 1280×800, 1024×768, and 375×812.
- Discovery popup content: world position and the "N grid-merged, not N
  sightings" fact, for both a count-1 row and a count-10 row.
- Search/filter correctness: a category toggle that hides a kind now
  correctly zeroes the search-summary count instead of reporting a stale
  match; "filters hide everything" shows its own message with a working
  reset; both re-verified end to end (toggle off, matches don't show; click
  reset, everything returns).
- First-run legend: auto-opens on cold `localStorage`, stays closed on a
  repeat visit, reopens via its own button, closes via Escape.
- Cluster bubbles coloured by dominant kind — seen rendered and colour
  confirmed via direct style inspection, but this was the FIRST version of
  the fix, before the opaque number pill existed (see next section).
- Credit line renders as one line at all three tested widths — also the
  FIRST version, before the opacity was raised from .68/.74 to .90/.96.
- `haven`/`myrland` current-page nav item: renders as a matching pill, not
  bare text, and is excluded from the tab order (confirmed via a live
  focusable-element walk, not just markup inspection).
- Keyboard tab order fix: actually tabbed through the live page and counted
  — `#filter-toggle` reached at tab press 2 (down from 157), `#search` at
  tab press 4. The skip link was activated (Enter) and confirmed to move
  focus to `#filter-toggle`, not just render.
- Focus rings on the landing page and the `haven`/`myrland` pages — tabbed
  to and screenshotted; visible gold ring, measured 7.9:1 against the panel
  background.

## Verified by direct inspection of the rendered images — not through this session's browser

The terrain/plate render fixes below were made, republished and inspected
entirely outside this session's tooling: a separate offline-pipeline
workstream, verified by the owner looking directly at the rendered
PNG/webp output, not by rendering the live map page. Distinct from the
section above (this session's own browser-driven checks of the map UI) and
from the section after it (arithmetic and byte-decoding with no human
viewing): a human did look at these, just not through this repository's
own tooling.

- **Foliage.** An achromatic `AlbedoColor` wind-tint parameter was
  outvoting the real leaf texture, rendering palm canopy near-white.
  2 of 1068 materials affected; fixed in the extractor. Canopy confirmed
  green, including a specific recount on the republished pash (104
  coconut-palm instances) and belrim (121 instances) town plates.
- **Gamma.** The renderer was treating linear `baseColorUu` as if it were
  already display-ready sRGB. Replaced with the standard transfer curve.
  Rock, roofs and buildings all lifted; the re-rendered town plates
  (bedia, yesil, beth_jedda, pash, belrim) inspected and dramatically more
  legible.
- **Violet squares.** A normal map was bound to a `PM_Diffuse` slot,
  averaging to its flat-tangent encoding. Now excluded by reading
  `CompressionSettings`. Fountains inspected and render as green water.
- **Dungeon-surface artwork plates.** Entrances were nearly invisible — a
  bare smudge in near-blank parchment. A second ink pass over the
  entrance-only coverage mask, at full strength, makes them the subject.
  Verified on Arg Kepher first, then the identical fix applied and
  inspected on all four dungeons (Arg Kepher, Jungle, Tuz Salt Mines,
  Yel Keskar).
- **Stale-publish race, caught and fixed.** `pash` and `belrim` had
  published byte-identical to their pre-fix hashes because `publish` read
  the PNGs before the async renders finished writing — a real bug, not a
  render defect. Caught, republished, and reverified against the actual
  rendered crop (the palm recount above).
- **Beth Jedda barn roofs — inspected, not a defect.** Three roofs remain
  the darkest thing on that plate. Measured (53,50,44)→(87,81,70) under the
  gamma fix: legitimately dark wood, now showing plank banding rather than
  reading as flat black. Physically faithful, left as-is.

## Verified by computation and build-artifact inspection — not rendered, not individually inspected

Correct by the same WCAG relative-luminance arithmetic used throughout this
session (independently sanity-checked against the spec's own worked
example) and confirmed to be what actually shipped by decoding the
minified `dist/` output back to RGB, or correct by tracing a shared code
path and confirming the republish completed without a render error — but
never seen by anyone, human or browser.

- **Dungeon fallback-material shading.** A `(0.5,0.5,0.5)` fallback
  placeholder material was being lit to near-white instead of shaded as
  unresolved rock. `material_colours()` now skips fallback entries; it is
  one function shared by every plate kind, so the fix applies to town,
  surface and dungeon-interior rendering alike. All nine dungeon interior
  levels affected (Arg Kepher L1–L2, Jungle L1–L2, Tuz Salt Mines L1–L3,
  Yel Keskar L1–L2) republished without a render error. Confirmed present
  in the committed `dungeonplates.json`/`dungeonplates-art.json` content
  hashes and covered by `test/asset-manifests.test.mjs`'s file-existence
  checks, but none of the nine level images has been individually
  eyeballed for the corridors actually reading as rock.
- **Realistic surface plates, gamma fix.** All four dungeons' realistic
  surface plates (Arg Kepher, Jungle, Tuz Salt Mines, Yel Keskar)
  republished under the same gamma fix verified on the town plates above.
  Three of the four have not been individually eyeballed.
- **Cluster numeral pill.** Every kind colour composited at the ring's
  shipped .58 alpha over pure white, then the pill over that, clears
  12.17–12.51:1 against the numeral (need: 4.5:1). Confirmed present in
  `dist/app-static.css` (`#1c160de0` decodes to rgba(28,22,13,.878)) and in
  `dist/app-static.js` (the dominant-kind selection and pill markup).
- **Credit line opacity.** Realistic style's `.90` alpha and artwork
  style's `.96` alpha both clear 4.5:1 against a pure-white worst-case
  backdrop (4.76:1 / 4.75:1). Confirmed present in the built CSS
  (`#0c0a08e6`, `#342814f5`, decoding to the intended values within 8-bit
  rounding). **Not** re-sampled against real desert/rock pixels in the
  realistic style, which is the specific thing owed from the prior round —
  still the top item to close out once a browser is back.
- **Map-chrome focus rings.** `#filter-toggle`, `#legend-toggle`,
  `.cat-toggle`, `.type-toggle`, `.only-btn`, `.expand-btn`, `.mg-btn`,
  `.mg-pop-item`, `#paste-loc-go`, `#paste-loc-go`'s siblings — every rule
  confirmed present in the built CSS, contrast confirmed at 7.4–8.2:1
  against the panel backgrounds each control sits on. Only the *landing
  page's* rings (a separate, unbundled stylesheet) were actually tabbed to;
  none of these map-page ones have been.
- **Legend cluster swatch.** Confirmed present and correctly valued in the
  built CSS (`.legend-cluster-ring` decodes to the intended rgba(160,90,74)
  at .58/.9 alpha, matching the real ring's formula) and the built HTML
  (nests the real `.cluster-count` span rather than a bespoke copy). Not
  seen rendered.

## Known gaps — honest, not silent

A working browser would close most of what is open:

- Pixel-sample the credit line over real terrain at the same two points
  used in the prior round; tab to each new map-chrome focus-ring target
  and screenshot; screenshot the default island view and a max-zoom
  cluster to see the real pill. None of this is unknown or untested
  reasoning — it is untested *rendering* of reasoning already checked
  twice by different methods (arithmetic, and decoding the actual shipped
  bytes).
- Individually eyeball all nine republished dungeon interior levels for
  corridor shading, and the three not-yet-inspected realistic surface
  plates, against the fallback-material and gamma fixes described above.
  Same code path as what's already been checked once; this is a repeat of
  an already-proven method, not new uncertainty.

Two gaps a browser will not close:

- Byte-size optimisation of the plate images — not attempted this round;
  no claim either way.
- `discoveries.css`'s `.popup-actions`/`.disco-class` styling
  (Details/Delete/Edit/Drag buttons, the class-name row) renders nothing
  in this static build — every producer is null-gated — but `main.css`'s
  own header states the private live build imports this exact file and
  layers its own panel/editor chrome on top of it. Whether that CSS is
  genuinely dead there too, or load-bearing, cannot be answered from this
  repository alone.
