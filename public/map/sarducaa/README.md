# Sarducaa

Served at: `https://api.varshen.com/map/sarducaa/`

The shared application, its build, and every asset not specific to this
continent live in [`../app/README.md`](../app/README.md). This file carries
only what's specific to Sarducaa: where it's served, and where its source
art lives while editing.

Map assets — source of truth while editing: the offline pipeline that renders
Sarducaa's tiles, town plates and dungeon plates from the game's own placed
geometry. Copy its output into `assets/` here before deploy when changing the
map image.

Sarducaa's own data provenance (tile pyramid, town plates, dungeon plates,
the world↔canvas transform) is documented in `../app/README.md`'s `## Data`
section, which is itself Sarducaa-specific — this is the only continent with
anything published yet. See [`../registry.js`](../registry.js) for the
declarative version of the same facts, and
[`../../../docs/map-coordinates.md`](../../../docs/map-coordinates.md) for
the coordinate transform.
