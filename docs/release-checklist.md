# Release checklist — Sarducaa public launch

Snapshot of what has been checked, how, and what has not, as of this
session's work on the map UI (search/filter correctness, discovery popups,
first-run legend, cluster bubble legibility, credit line, focus visibility,
keyboard tab order, and this consistency pass). Grouped by evidence strength,
not by feature, because the honest gap here is a *tool* gap (a browser
became unavailable mid-session), not a feature gap — several fixes are
correct by computation and by inspection of the built artifact, but have
not been seen rendered.

## Automated gates — always current

Re-run at every step of this session; both green as of the last commit.

- `node bin/build.mjs --verify` — `dist/` matches `src/` and `index.html`'s
  `?v=` stamps are current.
- `node --test test/*.test.mjs` — 51/51 passing (coordinate fit, static-file
  server headers/caching, and every snapshot-validator contract check).

## Verified live — actually rendered in a browser, screenshotted

True for everything below at the time it was built, using headless Chromium
via this session's browser tool. The tool became unavailable partway through
the session (confirmed by two independent checks, including a subagent run
in a fresh session); everything after that point is in the next section.

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

## Verified by computation and build-artifact inspection — not rendered

Correct by the same WCAG relative-luminance arithmetic used throughout this
session (independently sanity-checked against the spec's own worked
example), and confirmed to be what actually shipped by decoding the
minified `dist/` output back to RGB — but never seen on screen, because the
browser went down before these specific fixes were made.

- **Cluster numeral pill.** Every kind colour composited at the ring's
  shipped .58 alpha over pure white, then the pill over that, clears
  12.17–12.51:1 against the numeral (need: 4.5:1). Confirmed present in
  `dist/app-static.css` (`#1c160de0` decodes to rgba(28,22,13,.878), and in
  `dist/app-static.js` (the dominant-kind selection and pill markup).
- **Credit line opacity.** Realistic style's `.90` alpha and artwork
  style's `.96` alpha both clear 4.5:1 against a pure-white worst-case
  backdrop (4.76:1 / 4.75:1). Confirmed present in the built CSS
  (`#0c0a08e6`, `#342814f5`, decoding to the intended values within 8-bit
  rounding). **Not** re-sampled against real desert/rock pixels in the
  realistic style, which is the specific thing owed from the prior round —
  this is the top item to close out once a browser is back.
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

Everything in the section above needs one thing: a working browser, then a
five-minute repeat of checks this session already designed and ran once
before (pixel-sample the credit line over real terrain at the same two
points used last time; tab to each new focus-ring target and screenshot;
screenshot the default island view and a max-zoom cluster to see the real
pill). None of it is unknown or untested reasoning — it is untested
*rendering* of reasoning that has already been checked twice by different
methods (arithmetic, and decoding the actual shipped bytes).

Separately, and not fixed this session because it needs visibility this
task does not have: `discoveries.css`'s `.popup-actions`/`.disco-class`
styling (Details/Delete/Edit/Drag buttons, the class-name row) renders
nothing in this static build — every producer is null-gated — but
`main.css`'s own header states the private live build imports this exact
file and layers its own panel/editor chrome on top of it. Whether that CSS
is genuinely dead there too, or load-bearing, cannot be answered from this
repository alone.
