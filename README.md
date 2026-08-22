# mo2-map

A map of **Mortal Online 2** covering its three continents: **Myrland**, **Sarducaa**
and **Haven**. Terrain and topography rendered from the game's authored data; places
and things extracted from the game's own files and reported by a community survey,
published as coordinates and de-identified.

**Data published:** Sarducaa. **Rendered:** Myrland (not yet published).
**Not yet mapped:** Haven.

## What this is

The terrain is the game's shipped landscape data: heightmaps stitched into an
elevation model, the engine's own per-tile ground colour, water surfaces at
their authored levels. The point catalogue (`docs/snapshot.md`) is not a survey —
only part of the island has ever been walked, and the map has no way to tell a
blank patch that is unexplored from one that is explored and genuinely empty. A
coverage grid would say which is which; v1 shipped one and v2 retired it
deliberately, because a coverage grid is itself a record of where someone looked
and how often — exactly the kind of collection-activity metadata this snapshot
exists to not publish. So: absence on this map means *nobody has reported
anything there*, not *nothing is there*, and the map cannot currently show you
which.

## What is here today

| Path | What |
|---|---|
| `src/coordinates.js` | Sarducaa: world metres ↔ canvas pixels |
| `docs/coordinates.md` | the fit, its residuals, the origin correction, and the open scale question |
| `docs/snapshot.md` | snapshot contract: file format, field schema |
| `server/serve.mjs` · `local.ps1` | the site server and the local runner — [`docs/running.md`](docs/running.md) |
| `docs/release-checklist.md` | what's verified, how, and what's a known open gap before publishing |

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
