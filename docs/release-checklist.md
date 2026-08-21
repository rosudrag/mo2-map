# Release checklist — Sarducaa public launch

Snapshot of what has been checked, how, and what has not, as of this
session's full arc: closing out every item a prior session could only prove
by arithmetic or by decoding built bytes (a browser was unavailable then),
verifying a datapoint-aggregation pass on the catalogue, an image-by-image
direct inspection of the dungeon and surface plates, a page-weight
measurement (with a chased-down outlier), and — this final round — a
town-plate re-render that fixed a real defect, plus the last unverified
focus-ring targets. Grouped by evidence strength, not by feature: several
fixes are correct by computation, by inspection of the built artifact, or
by the owner's own direct look at rendered output images, but are marked
as such rather than folded into "seen live" unless this session's own
browser tool actually rendered them. As of this round, this document is
current on the whole tree — see "Publishable state" at the bottom.

## Automated gates — always current

Re-run at every step of this session; all three green as of the last
commit.

- `node bin/build.mjs --verify` — `dist/` matches `src/` and index.html's
  `?v=` stamps are current.
- `node --test test/*.test.mjs` — 78/78 passing: coordinate fit, static-file
  server headers/caching, every snapshot-validator contract check, and
  every asset-manifest consistency check (27 of the 78) — the ones that
  matter most this round, since all nine towns just republished in both
  styles with new content hashes. Re-run standalone after the town-plate
  round specifically (`node --test test/asset-manifests.test.mjs`, 27/27):
  confirmed every `townplates`/`townplates-art` manifest entry parses,
  names a file that exists on disk at the path the page fetches, leaves
  no orphaned image behind, and agrees with its style sibling on which
  keys it publishes — exactly the failure modes a bad republish produces.
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

## The town-plate round (landed after the previous version of this document)

A town plate — Kam — was rendering as a wreck: giant grey slabs over 39%
of the plate, the town itself invisible underneath. Root cause was
decorative rock meshes scaled 10–20× into 460–690 m backdrops; the
existing render guard checked an *absolute* triangle count, so it never
noticed that scaling had spread the same triangle budget over a vastly
larger area than the guard was calibrated for. Fixed with a scale-ratio
guard instead of an absolute one; a second pass then lowered that guard's
span floor after it still missed a 127 m case. All nine towns were
re-rendered and republished in both styles as a result — every
`townplates`/`townplates-art` content hash changed except one. Beth Jedda
was deliberately held byte-identical throughout, as the control: proof
the guard changes only affected plates that actually needed the scale
check, not a blanket re-render that could have quietly changed something
in a town that was never broken.

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

- `.expand-btn` (the chevron on a filter category with sub-types),
  `.type-toggle` (a sub-type row, "Bank", opened under its category),
  `.only-btn` (the "only" button on that sub-type row), and
  `#paste-loc-go` (the "PIN" button): all four tabbed to directly and
  screenshotted this round, closing out the last targets that were
  CSS-verified only. Every one shows the same visible bronze ring as the
  five above.

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
  renders as shaded rock, not the near-white fallback-material bug —
  closed live, in the browser, before the systematic direct-image-
  inspection pass below closed the other eight levels the same way.
  `Leave` returns cleanly to the surface map.
- Opened the continent switcher: lists Sarducaa (current), Myrland
  ("mapped, but this map isn't ready to show it yet"), Haven ("hasn't been
  mapped yet") — the blocked-state explanatory text renders correctly, not
  a bare disabled control.

**Town plates, this round — the actual point of this pass.** Fresh
server, fresh browser tab, `console`/`response` listeners attached from
before the first navigation:
- **Beth Jedda (the control, held byte-identical through the whole
  town-plate round)**: searched, flown to, screenshotted at plate zoom in
  both styles. Artwork: full walled town — gatehouse, courtyards,
  buildings, tree clusters — rendered crisply as hand-drawn plan.
  Realistic: the same town as a lit photographic render — sandstone
  buildings, roofs, interior pools, roads. Zero console errors, zero
  failed requests, in either style.
- **Kam (the town that had the defect — giant grey slabs over 39% of
  the plate — this round's actual fix)**: confirmed clean in both
  published files directly (not just live) and live in the browser.
  Read `townplates/kam.96533856c2.webp` and `townplates-art/kam.8f254a5df2.webp`
  from disk: the realistic file is a fully-detailed volcanic-terrain
  render (rock, a lake, boulder fields) with no grey-slab wreck anywhere
  in the frame; the artwork file is a small, sparse ink cluster
  consistent with a minor settlement, also clean. Live in the browser at
  Kam's manifest bounds: the DOM shows the plate `<img>` correctly
  attached to `.leaflet-townPlate-pane` (`kam.96533856c2.webp`, sized and
  positioned within the viewport), the fetched bytes match the on-disk
  file, and the composited pixels visually match the raw file exactly —
  confirmed by navigating there twice, independently: once via the
  manifest's own bounds converted to world coordinates, once via the
  app's own search-and-fit. Zero console errors, zero failed
  `townplates` requests either way. (Kam's settlement is small relative
  to its ~865 m apron — most of the plate is legitimately open volcanic
  terrain around it, the same "apron, not a wasted margin" shape the
  page-weight section already established for dungeon plates.)
- **A dungeon entrance (Arg Kepher's surface plate) and inside a dungeon
  (Arg Kepher's interior, both levels)**, re-driven fresh this round in
  both styles with the listeners attached throughout style switches:
  zero console errors, zero failed requests, at every step — entrance
  plate visible over the tile pyramid in both styles, interior renders
  correctly in both styles, `Leave` returns cleanly.

**Network/console baseline.** Every page load in the default/mainstream
viewing area (the landing view, Beth Jedda, Arg Kepher's entrance and
interior) showed exactly three failed requests and no others:
`assets/tiles/v4/-1/7/{-2,-3,-5}.webp` (404) — the three known-absent
edge tiles in the realistic pyramid, expected and harmless. `favicon.ico`
also 404s (checked directly), same as the brief says to expect. No other
4xx/5xx response, no `requestfailed`, no console error was seen at any
point across style switches, filter panel use, search, dungeon
entry/exit, the continent switcher, or Beth Jedda's town plate in either
style.

**One real deviation, found and reported, not papered over: Kam's own
corner of the map has more tile-pyramid gaps than the three documented
ones.** Navigating to Kam — a remote volcanic corner of the island —
pulled in a couple dozen additional `assets/tiles/v4/{z}/{x}/{y}.webp`
404s at zoom levels -1 through 1, reproducibly, on every visit. This is
**not** a town-plate defect: the URLs are all base-pyramid tile requests,
never `townplates`/`townplates-art`, and the gap is identical whether or
not Kam's plate itself is in view. It is a pre-existing sparse patch in
the realistic tile pyramid's coverage in that remote region, unrelated to
this round's town-plate republish, and not something this task's scope
covers fixing (that would mean re-running the tile-pyramid extraction,
not verifying a plate republish). Recorded here because the task's own
acceptance bar said the only 404s should be the three known edge tiles
plus favicon, and Kam's neighbourhood does not meet that bar — a reader
deciding whether this is publishable should know that corner of the
realistic pyramid is thinner than the rest of the island, independent of
everything else in this document being green.

## Verified by direct image inspection this session — not through the browser

The browser cannot decode a `.webp` any more faithfully than reading the
file directly, so this pass used the file-reading tool's own inline image
decoding instead: every one of the nine dungeon-interior levels and all
four realistic surface plates — the ones the prior round's "Known gaps"
section listed as republished-but-never-eyeballed after the gamma and
fallback-material fixes — opened and looked at directly, plus their nine
artwork-style siblings and four artwork surface plates for the same
general defect sweep (26 images total; the two town-plate directories
were excluded, per instruction at the time — see below for their current
state).

What was being looked for, per the fixes those levels were republished
under: corridor floors that once rendered as bright white-and-brown
striped bands (the `(0.5,0.5,0.5)` fallback material lit to near-white);
dark materials crushed to flat, featureless near-black (linear colour
read as sRGB); and blue-violet squares (a normal map bound to a diffuse
slot).

**Verdict: all 26 images good. None of the three defect patterns appears
anywhere.**

- **Dungeon interior, realistic** (`dungeonplates/`), 9/9: Arg Kepher L1–L2,
  Jungle L1–L2, Tuz Salt Mines L1–L3, Yel Keskar L1–L2. Every corridor
  reads as shaded mid-tone stone, distinct from but not brighter than the
  rooms; every room shows visible surface/furniture detail rather than
  crushing to black; no violet squares anywhere. Two things worth naming,
  neither a defect: a circular, greenish-rimmed rubble room appears in Arg
  Kepher L2 and a vivid green circular room in Tuz Salt Mines L3 — both
  reappear at the identical position and shape in their artwork siblings
  below, so they're an intentional room template, not a render fault.
  Small red decorative dots scatter through Jungle L2's rooms and
  corridors — plausible in-world decoration (embers/blood/berries), not
  visually broken, cause not otherwise confirmed.
- **Dungeon interior, artwork** (`dungeonplates-art/`), 9/9: same nine
  levels, ink-on-parchment style. Consistently legible line art, no
  defects. Confirms the anomalies noted above (the circular rooms, and
  two disconnected-fragment clusters described next) are real dungeon
  geometry, not artifacts of one render pipeline — they reproduce
  pixel-for-pixel in position across both independently-rendered styles.
  Two disconnected small clusters of geometry sit isolated from the
  explored maze with no corridor drawn to them: Tuz Salt Mines L2 (far
  right edge, roughly 88–96% across the canvas width, 47–61% down) and
  Yel Keskar L1 (a tiny dot cluster at ~96% across/56% down, plus a
  separate boulder cluster at ~20% across/90% down). Present identically
  in both styles — real, disconnected secondary geometry (or an unreached
  secret area), not a rendering bug in either pipeline.
- **Surface plates, realistic** (`surfaceplates/`), 4/4: Arg Kepher, Jungle,
  Tuz Salt Mines, Yel Keskar. Jungle's canopy renders correctly green
  (confirms the foliage-colour fix holds outside the two town plates it
  was already checked on); all four show full tonal range with visible
  surface detail even in shadowed cave mouths, no crush; Yel Keskar's pale
  rock face (the same terrain sampled for the credit-line contrast
  measurement above) shows legitimate faceted rock texture, not a defect.
  No violet squares on any of the four.
- **Surface plates, artwork** (`surfaceplates-art/`), 4/4: Arg Kepher, Jungle,
  Tuz Salt Mines, Yel Keskar. Arg Kepher's three dungeon-entrance ink
  patches are dark and legible (matches the entrance-legibility fix
  already verified in the prior round); Jungle and the other two are
  mostly-blank parchment with sparse outline ink, consistent and clean.

**`townplates/` and `townplates-art/` — settled since this section was
written, not swept the same exhaustive way.** The town-plate round
finished and republished all nine towns in both styles; this document's
"Verified live" section above covers what was actually checked
afterward — Beth Jedda (the control) live in both styles, and Kam (the
town that had the defect) both by reading the published bytes directly
and live in the browser, with the DOM/network evidence to back it. What
was *not* done: the same image-by-image sweep of all 18 town files
(9 towns × 2 styles) that the dungeon/surface plates got above. The
asset-manifest tests (27/27, re-run standalone after the republish)
cover the structural failure modes — a manifest naming a file that
doesn't exist, an orphaned image, a style mismatch — but not a visual
look at the other seven towns. Recorded as an open item below, not
silently claimed as covered.

## Page weight

Measured, not attempted before this round. Scope: the same four
directories reviewed above (`dungeonplates/`, `dungeonplates-art/`,
`surfaceplates/`, `surfaceplates-art/`, 26 files). `townplates/` and
`townplates-art/` were mid-republish when this measurement was taken and
are still excluded here — not because they're in flight any more (they
settled by the end of this session), but because this specific
measurement pass was never re-run against them afterward. Their weight is
simply unmeasured, not stale.

**Method.** File size and pixel dimensions read directly from disk/decode.
"Empty" estimated by decoding each image to a 256px-wide thumbnail,
taking the median colour of its four corner patches as the background
estimate, and measuring what fraction of pixels fall within a Euclidean
RGB distance of 12 from that colour. A second, more decision-relevant
number was measured the same way: the bounding box of *non*-background
pixels, as a fraction of the full canvas area — this is what a crop could
actually remove, as opposed to how speckled the canvas is. Both are
approximate: a fixed colour-distance threshold misclassifies soft
gradients (the realistic plates' vignette borders) and faint texture at
the margin either way, and the realistic surface plates in particular
have no genuine flat "unused" region to measure — they're full-bleed
photographic renders with a soft feathered edge, not blank canvas, so
their low computed "empty%" (0–35%) means something different from the
same figure on an ink plate and should not be read as "65–100% useful".

**Totals.**

| Directory | Files | Bytes | 
|---|---|---|
| `dungeonplates/` | 9 | 3.05 MB |
| `dungeonplates-art/` | 9 | 5.20 MB |
| `surfaceplates/` | 4 | 8.14 MB |
| `surfaceplates-art/` | 4 | 13.98 MB |
| **Grand total** | **26** | **30.37 MB** (31,846,058 bytes) |

Dimensions range 1683×1494 (the smallest dungeon level) to 6464×6546 (the
largest surface plates, Arg Kepher realistic and artwork both).

**The cropping question: measured, and the numbers say no.** Per-pixel
"empty" runs high wherever it's a meaningful measure — 74–95% on dungeon
interiors in both styles, 66–84% on the ink surface plates. That looks
like a cropping opportunity on first read. It is not one: the *bounding
box* of actual content is 88–100% of the full canvas in **every single
one of the 26 images**, dungeon and surface, both styles, with no
exception. Dungeon layouts snake diagonally from one corner of their
canvas to the opposite corner; the ink surface plates scatter
resource/terrain-boundary outlines across the whole plate. The "empty"
pixels are interspersed *between* content that already reaches every edge
of the canvas, not walled off in one excisable margin a rectangular crop
could remove. **Recomputing `bounds` and cropping would recover close to
nothing on this dataset — do not dispatch that as a task; the numbers
don't justify it.**

**Where the actual weight is going, and the jungle outlier chased to a
verdict: no bug, the content is what it is.** Bytes-per-megapixel across
the 26 files ranges from ~13,000 B/MP (`dungeonplates/jungle_l1.b68d2e1194.webp`,
cheap) to ~172,000 B/MP (`surfaceplates-art/jungle.b41432c225.webp`, the
outlier this round's follow-up chased). `surfaceplates-art/` as a
directory is 13.98 MB — 46% of the 30.37 MB total.

Chased with real numbers, not estimates:
- **Encode settings are identical across all four `surfaceplates-art/`
  files, confirmed by reading the publisher** (`auxilliary/mo2-terrain-map/
  tools/dungeon_plate.py`, read only — it's the other worker's file while
  the town-plate fix is in flight). All four route through the same
  `_publish_surface_plates()`, same `quality=84, method=5`, same RGBA
  save call; nothing in the repo ever calls `publish-surface-art` with a
  non-default quality. No per-file override exists to be a bug.
- **Re-encoded all four raw source PNGs** (present in this checkout at
  `auxilliary/mo2-terrain-map/work/surfaceplates-art/*.png`) at the exact
  publish settings, into system temp
  (`%TEMP%\platecheck_3lodxc41\*.webp`, not the repo). All four
  reproduced their published byte count **exactly** — jungle's
  5,527.0 KB, argkepher's 3,333.6 KB, tuz salt mines' 3,119.9 KB, yel
  keskar's 2,335.0 KB, byte-for-byte. The published files are exactly
  what quality 84/method 5 produces from current content: deterministic,
  no drift, no misapplied setting.
- **The size difference is real content, not waste.** Jungle's own
  header (`jungle_surface.json`) records the *lowest* coverage fraction
  of the four (0.398, vs Arg Kepher 0.621, Tuz Salt Mines 0.56, Yel
  Keskar 0.415) — less canvas has terrain footprint at all. But a
  Laplacian (high-frequency edge energy) measurement on the published
  pixels puts jungle at 3× Arg Kepher's value and above both other
  siblings. Lowest area, highest edge energy, is exactly what a more
  convoluted coverage boundary looks like — and that matches the QA
  pass above by eye: jungle's plate is dominated by a single huge tree
  root/canopy system, not the compact rock footprints the other three
  dungeons sit under. `paint_surface_artwork`'s wall-ink and cross-hatch
  (`dungeon_plate.py` ~L730–772) both trace the coverage mask's own
  gradient at a fixed 6px period — a longer, more convoluted boundary
  genuinely produces more ink detail for a lossy encoder to spend bits
  on, independent of quality setting.
- **Quality/size curve, measured for jungle** (temp re-encodes of the
  same source PNG, not the repo): q90 → 5,916.7 KB, q84 (published) →
  5,527.0 KB, q75 → 5,185.9 KB, q70 → 5,133.5 KB. Diminishing returns
  below the published quality: dropping to 75 recovers ~341 KB (6.2%);
  dropping further to 70 barely moves it another 52 KB. That is the
  signature of a real detail floor, not compressor slack left on the
  table.

**Verdict: no bug.** The encode path is identical and deterministic
across all four `surfaceplates-art/` files; jungle is larger because its
content genuinely has more edge/hatch detail (a more convoluted terrain
boundary), not a wasted alpha channel, an unwanted colour depth, or an
accidentally-lossless path. A quality-84→75 change would buy roughly 6%
on this one file at reduced fidelity — a taste/tradeoff call for whoever
owns that number, not a defect to fix. No reason from this evidence to
expect the other three are mis-encoded either, since they share the
identical deterministic path.

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

Empty as of this round. Both items that lived here (dungeon
fallback-material shading on the eight remaining levels; the gamma fix on
the three remaining realistic surface plates) were closed out by direct
image inspection this session — see "Verified by direct image inspection"
above. Kept as a section header rather than deleted, since it is where the
*next* computed-only claim belongs if one shows up.

## Known gaps — honest, not silent

- `townplates/` and `townplates-art/` were not swept image-by-image the
  way the dungeon/surface plates were (see "Verified by direct image
  inspection" above) — only Beth Jedda (control) and Kam (the fix) got a
  direct look, live and/or by reading the published bytes. The other
  seven towns rest on the asset-manifest tests (structural: files exist,
  no orphans, style parity) plus the fact they share the identical
  publish/guard code path Kam's fix landed in, not on anyone's eyes.
- Kam's own corner of the realistic tile pyramid has more gaps than the
  three documented edge tiles — found and reported above ("Network/
  console baseline"), not fixed; fixing it means re-running the tile
  extraction, outside this task's scope.
- The first-run legend, search-summary correctness, and the town/dungeon/
  surface plate layer set were not *re-driven* end-to-end against the new
  aggregated data this session (they were previously verified live, before
  the aggregation round, against the old catalogue). Nothing in the
  aggregation round touches this chrome's code path — it operates on
  labels and counts, not on which UI panels exist or when they toggle —
  so there is no plausible mechanism by which it broke them, but that is
  an argument from code review, not a fresh observation, and is recorded
  as such rather than silently claimed as re-verified.

One gap a browser was never going to close, now measured instead — see
"Page weight" above:

- Byte-size of the plate images: measured for the four dungeon/surface
  directories (30.37 MB, 26 files). Cropping was checked and ruled out
  by the numbers, not left unattempted; the compression-efficiency lead
  (`surfaceplates-art/jungle.b41432c225.webp`) was chased to a verdict —
  no bug, the content is what it is. `townplates/` and `townplates-art/`
  remain unmeasured — settled, but this pass was never re-run against
  them.

One more gap a browser will not close:

- `discoveries.css`'s `.popup-actions`/`.disco-class` styling
  (Details/Delete/Edit/Drag buttons, the class-name row) renders nothing
  in this static build — every producer is null-gated — but `main.css`'s
  own header states the private live build imports this exact file and
  layers its own panel/editor chrome on top of it. Whether that CSS is
  genuinely dead there too, or load-bearing, cannot be answered from this
  repository alone.

## Publishable state

**Yes, publishable as it stands.** Every automated gate is green,
including the asset-manifest tests re-run standalone against the actual
republished town-plate content hashes — the specific check that exists
to catch a bad republish (a manifest naming a file that no longer
exists, an orphaned image, a style mismatch). The defect this whole
chain of work was tracking down (Kam's grey-slab wreck) is confirmed
fixed: read directly from the published bytes and confirmed live in the
browser, by two independent navigation paths, with zero console errors
and zero failed `townplates` requests either way. The control town (Beth
Jedda) renders identically to how it always has, in both styles, proving
the guard fix touched only what needed touching. Every focus-ring target
this document ever listed as unseen is now seen. The jungle
compression-weight outlier flagged two rounds ago is chased to a
definitive "no bug" rather than left as an open question.

What a reader should know is still open, in order of how much it should
affect that yes:

1. **Seven of nine towns were not individually eyeballed this round** —
   only Beth Jedda and Kam were. They rest on the same guard fix and the
   same manifest tests as Kam, not on anyone having looked. This is the
   single item most worth closing before calling the town-plate round
   fully verified, not just gate-clean.
2. **Kam's own corner of the realistic tile pyramid is thinner than the
   rest of the island** — a genuine gap, unrelated to the town-plate fix
   and out of this task's scope to close, but real, and a player who
   wanders there will notice.
3. Three smaller, lower-stakes items carried from earlier rounds:
   `townplates`' page weight was never measured; the first-run-legend/
   search-summary/plate-layer chrome was reasoned safe against the
   aggregation round rather than freshly re-driven; and whether
   `discoveries.css`'s dead-looking rules are genuinely dead in the
   private live build can't be answered from this repository alone.

None of the three is a defect anyone has observed — they are places this
document is honest about not having looked, not places it found something
wrong and left it. That is the entire point of grouping by evidence
strength instead of by feature.

