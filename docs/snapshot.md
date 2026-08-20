# Snapshot Contract v2

A snapshot is a published dataset of places and things found on the game map.
The data is structured as JSON with a fixed field list, day-level date
precision, and no field that reconstructs collection activity.

## Overview

A snapshot is a directory containing three JSON files:
- `discoveries.json` — Grid-aggregated auto-discovered world objects
- `pins.json` — Curated/game-file catalogue of significant locations
- `manifest.json` — Export metadata: map id, schema version, counts, date

v1 also published `coverage.json`, a survey-progress grid recording which
cells had been visited and how often. It is retired in v2: a coverage grid
*is* collection-activity metadata — reconstructing it from anything else this
snapshot ships would defeat the point of removing the rest.

## Format Rules

### Published Fields

The snapshot publishes a fixed set of fields. `additionalProperties: false`
everywhere — an export or a validator fixture that adds a column must add it
to the schema and this table first.

### Forbidden Fields

The following never appear anywhere in a published file, at any nesting
depth: `first_seen`, `first_seen_at`, `first_seen_date`, `last_seen`,
`last_seen_at`, `last_seen_date`, `observations`, `seen_count`, `server_id`,
`serverId`, `published_count`, `published_observations`, `owner`, `seq`,
`status`, `note`, `api_key`, `user`, `account`, `ip`, `updated_by`, `source`,
`cls`, `class_name`, `className`.
Timestamps, sighting tallies, server/account identity, human-curation
provenance, and engine class identifiers are exactly what would let a reader
reconstruct who found what, when, and with what engine object — the
snapshot publishes *what is on the map*, not *who mapped it* or *what the
game engine calls it*.

### Date Granularity

Dates use `YYYY-MM-DD` format only; no sub-day precision. The only date field
left in v2 is manifest.json's `generated`. The validator enforces the rule
with two checks:

1. **Broad scan**: every string in every file is checked for a full ISO 8601
   timestamp (`YYYY-MM-DD[T ]HH:MM:...`).
2. **Strict validation**: `generated` must be exactly `YYYY-MM-DD`.

Bare times in free-text fields (e.g., a label reading `"12:30 meeting"`) are
allowed; they lack a date component.

## Files

### discoveries.json

Auto-discovered world objects, aggregated by grid cell — never one row per
raw sighting. A row is a named thing at a place: a kind, a human-readable
label, and a position. It carries no engine identifier — `label` is a
folded human name, not a class token.

**Aggregation rule**: group raw discoveries by `(kind, cls, grid cell)`, one
published row per occupied cell. Grid quantisation, not clustering: a
single-linkage clusterer chains dense fields of adjacent nodes into one
centroid kilometres from any real node (measured: 1,265 raw discoveries
collapsed into one cluster on this catalogue). A fixed grid cannot do that —
the cost is a *bounded* position error instead of an unbounded one.

Cell size is per kind: 64 m for `resource` and `spawn` (fields and creature
spawns are reported from noisy positions run to run; 64 m merges the noise
without merging distinct spawns), 16 m for `npc`, `structure`, and
`container` (every instance is a distinct object worth keeping separate — 16
m only dedupes repeat reports of the *same* object). The worst-case position
error is half the cell diagonal: ≈45 m at 64 m, ≈11 m at 16 m.

`kind: station` (player-housing workbenches) is dropped entirely at export —
furniture placed by a player is not a discovery.

**Schema**: Array of objects.

**Item fields**:
| Field | Type | Unit/Constraint | Required | Notes |
|-------|------|-----------------|----------|-------|
| `id` | String | 8 lowercase hex chars | Yes | `sha256("kind\|cls\|x\|y")[:8]` over the published position — stable across re-exports of an unmoved row |
| `kind` | Enum | resource, spawn, npc, structure, container | Yes | Object category |
| `label` | String | non-empty, ≤128 chars | Yes | Human-readable name |
| `x`, `y`, `z` | Integer | Metres | Yes | Cell centroid, rounded to the nearest metre |
| `count` | Integer | ≥1 | Yes | How many nodes were merged into this row — "this many things here", not "seen this many times" |

**Constraints**:
- `additionalProperties: false` — No extra fields allowed

### pins.json

Curated points of interest, extracted from the game's own files rather than
collected from play — no discovery timestamp exists for a pin because
nothing was ever "discovered".

**Schema**: Array of objects.

**Item fields**:
| Field | Type | Unit/Constraint | Required | Notes |
|-------|------|-----------------|----------|-------|
| `id` | String | non-empty | Yes | Stable identifier |
| `label` | String | ≤128 chars | Yes | Human-readable name |
| `type` | String | — | Yes | Pin type (e.g., Dungeon, Elevator) |
| `category` | String | — | Yes | Category slug (e.g., dungeon, elevator) |
| `map_x`, `map_y` | Number | Canvas pixels | Yes | 2D map canvas coordinates |
| `world_x`, `world_y`, `world_z` | Number | Metres | No | World position, if known |

**Constraints**:
- `additionalProperties: false`

### manifest.json

Export metadata and summary statistics.

**Schema**: Object.

**Fields**:
| Field | Type | Value/Constraint | Required | Notes |
|-------|------|-----------------|----------|-------|
| `id` | String | — | Yes | Map identifier, e.g. `"sarducaa"` |
| `schema_version` | String | "v2" | Yes | Contract version |
| `generated` | ISO 8601 date | YYYY-MM-DD | Yes | Export date |
| `counts` | Object | — | Yes | Summary counts (see below) |

**Counts subobject** (`additionalProperties: false`):
| Field | Type | Notes |
|-------|------|-------|
| `discoveries` | Integer | Total discovery rows in snapshot |
| `pins` | Integer | Total pins in snapshot |
| `by_kind` | Object | Discovery row count per kind enum |

## What Is Deliberately Not Published

No row here identifies a player, a server, or a play session. No timestamp
carries sub-day precision, so no row can be placed in a session. No count
reports how many times something was *seen* — only how many nodes a cell's
row merges, which is a property of the map, not of anyone's play history.
There is no coverage grid, because a coverage grid is itself a record of
where someone looked and how often. What ships is the catalogue: what is on
the map, aggregated and de-identified from how it was found.

### Excluded Rows

Six rules remove rows before publication. They are applied by the exporter,
which prints what each one removed on every run.

**Player property.** Nothing a player built or hired: house stables and
workbenches, campfires, siege equipment, guild relics, duel rings, and the
staff installed on a plot — stewards, territory bankers, guild guards, and
the vendors and priests standing in the yard. A holding is identified by the
four things only an owner installs, and everything installed within 150 m of
one goes with it. A town overrides that footprint, because a town's own
guards and vendors are world content even when somebody has built next door.
Note that public workbenches exist inside NPC towns, which is why a workbench
does not mark a holding.

**Player remains.** Character spirits, and the boxes spiritism keeps spirits
in. Both record a person rather than a place.

**Somebody's pet.** A creature standing in a town or on a holding is a pet or
a parked mount, not a spawn point. Wild animals do not spawn inside a guarded
town, and the rows bear that out: what sits in the towns is the tameable
roster — horses, gamals, panthers, terrorbirds, hunter lizards. Note the
deliberate asymmetry with the rule above: for an installed thing a town means
"world content, keep", because towns are full of world buildings and staff;
for a creature a town means the opposite.

**Resources nobody travels for.** Palm and Wolfbrush. Unlike every other rule
here this one is a judgement rather than a measurement — both are localised
enough to survive the ubiquity cut and are still noise, because the thing
they mark is not worth the trip. It is recorded as a list precisely because
it cannot be re-derived from the data.

**Ubiquitous resources.** A resource class present across more than 15% of
the surveyed area is dropped: a plant found in one of every three places
anyone has been describes the species, not the map. The threshold sits in a
real gap in the measured distribution — the widespread foraging plants land
between 18% and 31% of patches, everything localised at 12.7% and below.
Deliberately not applied to creature spawns, whose spread runs from 48%
downward with no gap, so any cut there would be an arbitrary line presented
as a measurement.

**Unnameable rows.** Engine placeholders that reduce to no name. A row whose
own identity is `PickableFieldInstance` tells a reader less than an absent
row does.

## Validator Enforcement

The validator (`bin/validate-snapshot.mjs`) enforces this contract. It exits
0 on pass and non-zero on failure, reporting all violations in a single run.

Violations detected:
- Missing required fields
- Unexpected additional fields
- Type mismatches (id format, integer bounds, enum membership)
- Forbidden fields, anywhere, at any nesting depth
- A `label` that looks like a raw engine class name instead of a folded human name
- Sub-day timestamp precision
- Date format violations

## Units Reference

- **World coordinates** (discoveries; pins optional): Unreal Engine world
  metres. Discoveries are integer (grid-cell centroids); pins keep source
  precision.
- **Canvas coordinates** (pins `map_x`, `map_y`): 2D image pixels on the
  exported map canvas.

## Enum Values Reference

### kind (discoveries only)
- `resource` — Gatherable resource node
- `spawn` — Spawn point or respawn location
- `npc` — Non-player character or merchant
- `structure` — Building, wall, or permanent structure
- `container` — Chest, crate, or other container
