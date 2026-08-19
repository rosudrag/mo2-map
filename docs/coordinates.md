# Coordinates — world metres ↔ the Sarducaa canvas

The map draws in Leaflet `CRS.Simple` pixels on a **5120×3579** canvas (`lat` = Y
from the bottom, `lng` = X from the left). World positions are Unreal world
**metres**. This is the transform between them.

Published deliberately: it is what lets anyone align their own measurements to
this map's frame. `src/coordinates.js` is the implementation and the single source
of truth — no consumer may hold a second copy of the constants.

## The formula

```text
lng = pxPerMetre * worldX + originLng
lat = originLat  - pxPerMetre * worldY      # map lat runs opposite world Y

pxPerMetre = 0.213641          # 4.6807 m per pixel
originLng  = 1783.4447         # lng at world X = 0
originLat  = 1709.1136         # lat at world Y = 0
```

Inverse:

```text
worldX = (lng - originLng) / pxPerMetre
worldY = (originLat - lat) / pxPerMetre
```

Axis-aligned, uniform scale, **no rotation** — world +X is map east, world +Y is
map *south*. The canvas covers world X ≈ −8348…+15618 m and Y ≈ −8552…+8200 m;
the island occupies roughly X −8100…+7900, Y −7750…+7700.

**The constants describe THIS canvas.** Re-cut it without re-fitting and every
consumer is silently wrong.

## How it was fitted (2026-07-28)

Three anchors, each a known world position paired with the same place identified
on this canvas. Least squares over a constrained similarity — one scale, two
offsets: 3 unknowns, 6 equations.

| Anchor | world X | world Y | lat | lng | residual |
|---|---|---|---|---|---|
| Ben Jedda | 2946.4157 | −1938.3203 | 2176.0 | 2427.0 | 81 m |
| Bedia | 3202.2903 | −3816.5842 | 2554.6 | 2460.5 | 68 m |
| Aur | 989.7323 | −6545.9641 | 3152.9 | 1987.9 | 35 m |

Worst residual 17.3 px. That is identification precision, not model error: 1 px is
4.7 m, and two of the three anchors are recorded somewhere *inside* a town rather
than at its centre.

> **The residuals are measured against the origin as fitted — `originLat`
> 1751.8418 — not against the `originLat` published above.** The origin was
> corrected 200 m south afterwards (next section), so checking this table against
> the shipped constants puts every anchor ~200 m out: Ben Jedda 256 m, Bedia 145 m,
> Aur 214 m. That is the correction, not a broken fit. `test/coordinates.test.mjs`
> asserts both halves — the residuals under the fit origin, and the exact 200 m
> offset between the two origins — so neither can drift unnoticed.

**The scale has independent confirmation.** An earlier 2884×2916 raster was
registered onto this canvas by masked cross-correlation (scale 1.2200), and a set
of pins digitised against that raster was separately fitted to world coordinates.
Composed, that chain lands within **0.3%** of the 0.213641 above — from entirely
different measurements. Registration cannot pin the *offset* (the correlation
surface is flat to ±80 px across renders), so the anchors decide that.

## The 2026-08-10 origin correction

`originLat` was **1751.8418** until 2026-08-10. Live position markers rendered
**~200 m north** of where they belonged, so the origin moved south by
`200 × 0.213641 = 42.7282` px.

The anchors could not catch this: they *are* the measurement that was wrong, and
the fit reproduces them to ±60 m by construction. A bias observed independently of
the fit is the only evidence that can see it — and a bias determines exactly one
thing, the origin. So this was a correction, not a re-fit. `pxPerMetre` is
untouched: it is independently confirmed to 0.3%, and a scale error would appear as
a bias that *grows* with distance from the anchor triangle, which is not what was
observed.

## The open question: a 3.2% scale disagreement

Registering our georeferenced terrain raster's coastline against the game's own map
art puts its canvas footprint at **4.53 m/px**. The constants above say **4.68
m/px** — 3.2% apart.

Supporting the discrepancy: the art's land footprint is 7.8% larger *linearly*
than our above-sea-level land at the constants' scale, and area is a far more
robust estimator than a bounding box.

Against reading anything into it: land-versus-painted-coast classification differs
between the two masks; the coastline IoU peak is broad (0.8393 at best, 0.78 at
3.7% away); and the older independent chain agreed with 0.2140/0.2143 px/m.

A 3.2% scale error would look like a bias that **grows** with distance from the
anchor triangle — and for anchors as clustered as these three are, that is nearly
indistinguishable from the constant ~200 m bias already corrected in the origin.
Terrain and pins share one transform by construction, so this no longer decides
where terrain sits *relative to* the pins; it still decides whether either is at
the right world position.

It can only be settled by new anchors — three or more, **spread across the
continent** rather than clustered in the south-east. Until then no constant moves.

## Re-fitting

1. Identify at least **three well-separated places** (kilometres apart — two
   points 200 m apart cannot resolve scale) for which you have both a world
   position in metres and the corresponding canvas `lat,lng`.
2. Fit `lng = k·worldX + a`, `lat = b − k·worldY` by least squares with a single
   shared `k`.
3. Write `pxPerMetre` / `originLng` / `originLat` and the anchor table into
   `src/coordinates.js`, residuals included.
4. Sanity check with a fourth position that was **not** in the fit: it must land
   where it should.
5. `npm test` — the anchor test reads the table you just wrote and fails if any
   anchor falls outside its own recorded residual.

Prefer absolute per-item coordinates over a second relative correction stacked on
the first.
