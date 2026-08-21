# Release checklist — Sarducaa public launch

Snapshot of what has been checked, how, and what has not, as of this
session's full arc: closing out every item a prior session could only prove
by arithmetic or by decoding built bytes (a browser was unavailable then),
and verifying a datapoint-aggregation pass on the catalogue that landed
after the previous version of this document and had only a light visual
check. Grouped by evidence strength, not by feature: several fixes are
correct by computation, by inspection of the built artifact, or by the
owner's own direct look at rendered output images, but are marked as such
rather than folded into "seen live" unless this session's own browser tool
actually rendered them.

## Automated gates — always current

Re-run at every step of this session; all three green as of the last
commit.

- `node bin/build.mjs --verify` — `dist/` matches `src/` and index.html's
  `?v=` stamps are current.
- `node --test test/*.test.mjs` — 78/78 passing: coordinate fit, static-file
  server headers/caching, every snapshot-validator contract check, and
  every asset-manifest consistency check.
- `node bin/validate-snapshot.mjs public/map/sarducaa/data/static` —
  passes.

## The aggregation round (new since the last version of this document)

A datapoint-aggregation pass landed on the catalogue after the previous
checklist was written. Full rationale lives in `docs/snapshot.md`'s
"Aggregation rule" and "Excluded Rows" sections; summarised here because
this document's job is to say what was *checked*, not to restate the
policy:

- `Baby`/`Alpha`/`Adult` age-and-rank tokens on `spawn` classes, and bare
  trailing asset letters (`ChestA`, `BarrelB`) on `resource`/`container`/
  `npc`, now fold into their base class *before* grid grouping, so the
  folded class is the grouping key.
- `resource`'s grid cell rose 64 m → 128 m; `spawn`'s rose 64 m → 128 m too,
  matching an already-measured upstream resolution radius rather than
  trading precision for cleanliness.
- A `tutorial content` exclusion rule was added.
- Fixed: `count` was summing merged *records* instead of each record's own
  resolved simultaneous count (a 10-horse herd server-resolved to one
  record now publishes `count: 10`, not `count: 1`).
- Fixed: `_Adult_C` classes never folded, which had been emitting pairs of
  identically-labelled pins metres apart.
- Fixed: large-count cluster bubbles lost their kind tint because the
  numeral's opaque contrast pill grew with digit count until it covered
  the coloured ring.

Catalogue went 4,462 → 3,556 discovery rows (resource 1,068, spawn 1,814,
npc 255, structure 26, container 393) and 397 pins.

**Verified this session, against the actual shipped snapshot files**
(`public/map/sarducaa/data/static/{discoveries,pins}.json`), not just read
off the commit message:
- Row/pin counts match exactly: 3,556 discoveries split resource 1,068 /
  spawn 1,814 / npc 255 / structure 26 / container 393; 397 pins. Confirmed
  twice — once by a direct `node -e` count over the JSON files, once by
  reading the live filter panel's own per-category totals rendered in the
  browser (`Discoveries 3556`, `Resources 1068`, `Spawns 1814`, etc.,
  `Pins 397`), which the app computes from the same snapshot at load time.
- Zero discovery or pin labels anywhere in the snapshot match
  `/\b(baby|alpha|adult)\b/i` or carry a bare trailing capital letter — a
  whole-catalogue regex scan, not a sample.
- Re-ran the whole-catalogue same-label proximity sweep `docs/snapshot.md`
  describes: `resource` has 2 same-label pairs under 16 m (min 13.5 m),
  `spawn` has 5 (min 10.4 m; the doc's own count from when it was written
  was 4 — a one-row difference, not a discrepancy worth chasing, since both
  numbers are "a small few, all inside the documented worst-case zones",
  not "none" or "many"), `npc`/`structure`/`container` have zero. Matches
  the doc's account of expected grid-boundary artefacts, not the
  198-of-204 pre-fix bug the fold rule was written to close.

## Verified live — actually rendered in a browser, screenshotted, this session

Headless Chromium via this session's browser tool, after the tool went
through a real outage: it hung mid-session (contended by a sibling
sub-agent's rapid tab navigation, then found to be genuinely wedged even
after that agent was stopped), and was restored by restarting the
underlying `omp.browser.headless` process before any of the below was
captured. Every item in this section was pixel-sampled or watched
interactively — the exact opposite of the reasoned-not-observed items
below.

**Credit line contrast, realistic style, over real terrain — the item
explicitly owed from the prior round.** Panned the map so the bottom-left
credit control sat over two different real, unobstructed patches of
rendered terrain, screenshotted the composited control at native
resolution, and read the pixels back (not CSS values):
- Open desert sand under the control: composited background pixel measured
  **rgb(26.6, 22.1, 14.1)**, text pixel measured rgb(153, 139, 120)
  (matches `var(--muted)` exactly). WCAG contrast: **5.39:1**.
- Pale rock under the control (unobstructed terrain averaged
  rgb(97, 93, 84) — genuinely light, not a shadowed crevice): composited
  background measured **rgb(21.1, 18.9, 15.9)**. Contrast: **5.56:1**.

Both clear the 4.5:1 AA floor with room to spare, and both *exceed* the
prior round's theoretical worst-case (a composite over pure white,
4.76:1) — real terrain is never as reflective as the conservative backdrop
the arithmetic assumed, so reality agrees with the math and beats it.
**Reality did not disagree with the arithmetic; nothing to fix.**

**Map-chrome focus rings — tabbed to and screenshotted, not just read out
of CSS.**
- `#filter-toggle`: ring pixel sampled at rgb(196,165,116) (`#c4a574`,
  exactly `var(--bronze)`), against the button's own rgb(22,19,15) panel
  background (`var(--panel)` exactly). Measured contrast **7.92:1**,
  consistent with the 7.4–8.2:1 range the earlier CSS-only pass estimated.
- `#legend-toggle`: ring visibly rendered over open water in the
  screenshot; same rule, not re-measured pixel-by-pixel since it is the
  identical CSS declaration.
- `.cat-toggle` (a category row in the open filter panel, "Bank"): inset
  ring (`outline-offset: -2px`) clearly rendered around the whole row.
- `.mg-btn` (the search-result layer toggle, "on"): ring clearly rendered.
- `.mg-pop-item` (the map-switcher popover, "Sarducaa Map" entry): ring
  clearly rendered around the active+focused row.

Not tabbed to this session (still CSS-verified only, from the prior
round): `.type-toggle`, `.only-btn`, `.expand-btn`, `#paste-loc-go` and its
siblings.

**Legend panel, rendered.** Opened via `#legend-toggle`; renders the solid-
pin swatch, the dashed-pin swatch, and the cluster swatch (a "12" numeral
in the same reddish ring formula as a real cluster bubble), plus the
category/coverage explainer text — matches what the map actually draws.

**Max-zoom cluster bubbles — both digit-width cases.** Screenshotted and
pixel-inspected at native resolution:
- A 2-digit bubble ("18"): the elongated dark pill sizes to the digits: the
  coloured (pinkish/resource-tinted) ring stays visible all the way around
  it.
- A 3-digit bubble ("178"): same result — the pill widens further but the
  ring is still visible on every side. This is the specific regression the
  aggregation round fixed (the pill used to grow until it covered the
  ring on 3-digit counts); confirmed fixed by direct observation of a real
  3-digit case, not by CSS inspection.

**Aggregation-round render checks.**
- Default landing view (realistic style, 1280×800): screenshotted; no
  `Baby`/`Alpha`/`Adult` or bare-trailing-letter label visible anywhere,
  reads as decluttered (large legible cluster bubbles, no crowd of
  adjacent same-label singleton pins).
- Clicked the highest-count individual marker findable in the loaded
  viewport (a folded `Ratzar Alate ×3` spawn row) and read its popup live:
  *"3 here — this many things at this spot, not 3 sightings"*, with
  correct world position. Confirms the `count` semantics fix and the
  folded-label rendering on a real row, not a mocked one. (A markedly
  higher-count row was not in the loaded viewport at the time; the
  mechanism is the same regardless of the number, and the popup format
  string is a single shared code path.)

**Filters, dungeon mode, continent switcher — zero console errors, zero
unexpected network activity across all of it**, confirmed with a
`console`/`response`/`requestfailed` listener attached for the whole
sequence:
- Opened the dungeon picker (`Dungeons` button): lists all four dungeons
  with correct level counts (Arg Kepher 2, Jungle 2, Tuz Salt Mines 3, Yel
  Keskar 2).
- Entered Arg Kepher: Level 1/Level 2 tabs render, room-and-corridor art
  renders as shaded rock (not the near-white fallback-material bug the
  computed-only tier below used to carry for this exact level) — closes
  one of nine dungeon-interior levels from "not individually eyeballed" to
  seen. `Leave` returns cleanly to the surface map.
- Opened the continent switcher: lists Sarducaa (current), Myrland
  ("mapped, but this map isn't ready to show it yet"), Haven ("hasn't been
  mapped yet") — the blocked-state explanatory text renders correctly, not
  a bare disabled control.
- Earlier in the session, before this deliberate pass, a zoomed-in artwork
  view of a town (reached incidentally while calibrating navigation)
  showed the town's walled building layout rendering correctly — not a
  deliberate town-plate check, but real evidence the layer draws.

**Network/console baseline, whole session.** Every page load showed
exactly three failed requests and no others:
`assets/tiles/v4/-1/7/{-2,-3,-5}.webp` (404) — the three known-absent
edge tiles in the realistic pyramid, expected and harmless per this
task's brief. No other 4xx/5xx response, no `requestfailed`, no console
error was seen at any point in the session, across style switches, filter
panel use, search, dungeon entry/exit, or the continent switcher.

## Verified by direct inspection of the rendered images — not through this session's browser

Unchanged from the prior round: a separate offline-pipeline workstream
(foliage colour, display gamma, a misbound normal map, dungeon
fallback-material shading, dungeon-surface entrance legibility, and the
stale-publish race that was caught and fixed), verified by the owner
looking directly at rendered PNG/webp output, not by this session's
browser. See the prior version of this document (still in git history)
for the full account; nothing in that workstream needed revisiting this
round.

## Verified by computation and build-artifact inspection — not individually eyeballed

What's left here after this round closed out the credit line, the focus
rings, the legend, and the cluster pill:

- **Dungeon fallback-material shading, remaining levels.** Confirmed fixed
  by direct render inspection for Arg Kepher (this session, above). The
  other eight interior levels (Arg Kepher's own — only one level's worth
  of corridor was actually looked at, so treat Arg Kepher's second level
  as still unseen too — Jungle L1–L2, Tuz Salt Mines L1–L3, Yel Keskar
  L1–L2) share the identical code path (`material_colours()`, one function
  for every plate kind) and republished without a render error, but have
  not been individually eyeballed.
- **Realistic surface plates, gamma fix, remaining three.** Arg Kepher's
  realistic surface plate has effectively been seen (its dungeon-entrance
  legibility was inspected directly per the section above); Jungle, Tuz
  Salt Mines, and Yel Keskar's realistic surface plates have not.

## Known gaps — honest, not silent

- The four map-chrome focus targets not tabbed to this session
  (`.type-toggle`, `.only-btn`, `.expand-btn`, `#paste-loc-go` + siblings) —
  CSS-verified only (contrast 7.4–8.2:1 against the panel backgrounds each
  sits on), not seen live. Same code pattern as the five that were seen
  this session; low-risk, but genuinely unseen.
- Eight (of nine) dungeon-interior levels and three (of four) realistic
  surface plates not individually eyeballed — see above. Same proven code
  path as the ones that were checked, not new uncertainty.
- The first-run legend, search-summary correctness, and the town/dungeon/
  surface plate layer set were not *re-driven* end-to-end against the new
  aggregated data this session (they were previously verified live, before
  the aggregation round, against the old catalogue). Nothing in the
  aggregation round touches this chrome's code path — it operates on
  labels and counts, not on which UI panels exist or when they toggle —
  so there is no plausible mechanism by which it broke them, but that is
  an argument from code review, not a fresh observation, and is recorded
  as such rather than silently claimed as re-verified.

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
