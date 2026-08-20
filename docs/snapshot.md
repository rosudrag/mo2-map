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
`status`, `note`, `api_key`, `user`, `account`, `ip`, `updated_by`, `source`.
Timestamps, sighting tallies, server/account identity, and human-curation
provenance are exactly what would let a reader reconstruct who found what and
when — the snapshot publishes *what is on the map*, not *who mapped it*.

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
raw sighting.

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
| `cls` | String | ≤160 chars | Yes | Game class token (e.g., `BP_Camp_T2_C`) |
| `label` | String | ≤128 chars | Yes | Human-readable name |
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

## Validator Enforcement

The validator (`bin/validate-snapshot.mjs`) enforces this contract. It exits
0 on pass and non-zero on failure, reporting all violations in a single run.

Violations detected:
- Missing required fields
- Unexpected additional fields
- Type mismatches (id format, integer bounds, enum membership)
- Forbidden fields, anywhere, at any nesting depth
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
