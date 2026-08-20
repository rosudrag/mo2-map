# mo2-map

A static, measured map of **Mortal Online 2's Sarducaa** — terrain, water, towns,
dungeons and a surveyed world catalogue — served as plain files. No server, no
accounts, no API.

**Status: bring-up.** This repo currently holds the coordinate contract (below).
The map application, the tile pyramids, the town and dungeon plates and the
versioned data snapshot land next.

## What this is

The terrain is not a scrape of anyone's artwork. It is the shipped landscape data,
stitched and measured: heightmaps into a world elevation model, the engine's own
per-tile material bake as the ground colour, water surfaces at their authored
levels. Coverage and failures are counted and published rather than assumed — a
component whose heightmap will not read is reported as failed, never silently
drawn as flat ground.

The world catalogue is a survey: a record of where somebody has actually ridden.
That is a weaker claim than a map of the island, and it is made honestly —
`coverage` ships alongside the data, and unsurveyed ground is drawn as unsurveyed
rather than as empty. In this dataset, absence almost always means *nobody has
been there*, not *nothing is there*.

## What is here today

| Path | What |
|---|---|
| `src/coordinates.js` | world metres ↔ canvas pixels — the single source of truth |
| `docs/coordinates.md` | the fit, its residuals, the origin correction, and the open scale question |
| `docs/snapshot.md` | snapshot contract: file format, field schema, privacy rules, validator enforcement |

```bash
npm test        # no dependencies, Node 20+
```

## The coordinate contract

The map draws in Leaflet `CRS.Simple` pixels on a 5120×3579 canvas; positions are
Unreal world metres. Axis-aligned, uniform scale, no rotation:

```text
lng = 0.213641 * worldX + 1783.4447
lat = 1709.1136 - 0.213641 * worldY      # map lat runs opposite world Y
```

This is published on purpose. It is what lets anyone align their own measurements
to this map's frame instead of guessing at it. The full derivation — three
anchors, their residuals, an independent confirmation of the scale to 0.3%, the
origin correction of 2026-08-10, and the unresolved 3.2% scale disagreement — is
in [`docs/coordinates.md`](docs/coordinates.md).

## Licence

Code: **Apache-2.0** ([`LICENSE`](LICENSE)).
Data and measurements: **CC BY-SA 4.0** ([`LICENSE-DATA.md`](LICENSE-DATA.md)).

Mortal Online 2 is a trademark of Star Vault AB. This project is unaffiliated with
and unendorsed by Star Vault.
