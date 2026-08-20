# mo2-map

A map of **Mortal Online 2** covering its three continents: **Myrland**, **Sarducaa**
and **Haven**. Terrain and topography rendered from the game's authored data; places
and things players have found, published as coordinates with coverage.

**Data published:** Sarducaa. **Rendered:** Myrland (not yet published).
**Not yet mapped:** Haven.

## What this is

The terrain is the game's shipped landscape data: heightmaps stitched into an
elevation model, the engine's own per-tile ground colour, water surfaces at
their authored levels. We count and report coverage; unexplored areas are drawn
as unexplored rather than as empty. Absence usually means *nobody has been
there yet*, not *nothing is there*.

## What is here today

| Path | What |
|---|---|
| `src/coordinates.js` | Sarducaa: world metres ↔ canvas pixels |
| `docs/coordinates.md` | the fit, its residuals, the origin correction, and the open scale question |
| `docs/snapshot.md` | snapshot contract: file format, field schema |

```bash
npm test        # no dependencies, Node 20+
```

## Sarducaa coordinates

The Sarducaa map draws in Leaflet `CRS.Simple` pixels on a 5120×3579 canvas;
world positions are Unreal engine metres. Axis-aligned, uniform scale, no
rotation:

```text
lng = 0.213641 * worldX + 1783.4447
lat = 1709.1136 - 0.213641 * worldY      # map lat runs opposite world Y
```

This lets anyone measure in-game and align to the map frame. The derivation — three
ground-truth anchors, their residuals, independent scale confirmation to 0.3%, the
2026-08-10 origin correction, and the unresolved 3.2% scale disagreement — is
documented in [`docs/coordinates.md`](docs/coordinates.md).

## Licence

Code: **Apache-2.0** ([`LICENSE`](LICENSE)).
Data and measurements: **CC BY-SA 4.0** ([`LICENSE-DATA.md`](LICENSE-DATA.md)).

Mortal Online 2 is a trademark of Star Vault AB. This project is unaffiliated with
and unendorsed by Star Vault.
