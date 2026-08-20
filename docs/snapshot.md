# Snapshot Contract v1

A snapshot is a published dataset of places and things found on the game map,
along with coverage reporting. The data is structured as JSON with a fixed field
list and day-level date precision.

## Overview

A snapshot is a directory containing four JSON files:
- `discoveries.json` — Player observations of game world objects
- `pins.json` — Curated catalogue of significant locations
- `coverage.json` — Map coverage: which grid cells have been visited and how often
- `manifest.json` — Export metadata, summary counts, applied filters

## Format Rules

### Published Fields

The snapshot publishes a fixed set of fields. Internal database columns are not
part of the published format.

### Date Granularity

Date fields use `YYYY-MM-DD` format only; no sub-day precision. The validator
enforces this with two checks:

1. **Broad scan**: All strings are checked for full ISO 8601 timestamps
   (`YYYY-MM-DD[T ]HH:MM:...`), which would violate the rule.
2. **Strict validation**: Date fields (`first_seen_date`, `last_seen_date`,
   `snapshot_date`) must be exactly `YYYY-MM-DD` format.

Bare times in free-text fields (e.g., label `"12:30 meeting"`) are allowed; they
lack a date component.

## Files

### discoveries.json

Player observations of game world objects. Pooled rather than attributed, because
the dataset is about the world, not about who found what.

**Schema**: Array of objects.

**Item fields**:
| Field | Type | Unit/Constraint | Required | Notes |
|-------|------|-----------------|----------|-------|
| `id` | UUID | — | Yes | Stable identifier; format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `kind` | Enum | spawn, resource, container, npc, structure | Yes | Object category |
| `class_name` | String | — | Yes | Unreal engine class; max 160 chars (e.g., `BP_Camp_T2_C`) |
| `label` | String | — | Yes | Human-readable name; max 128 chars |
| `world_x`, `world_y`, `world_z` | Number | Metres | Yes | World position; quantised to 1 m |
| `observations` | Integer | — | Yes | Number of separate sightings (samples); ≥1. Example: three sightings of the same object yields `observations = 3` |
| `seen_count` | Integer | — | Yes | Maximum instances seen simultaneously in a single sample; ≥1. Example: one sample sees three instances at once yields `seen_count = 3`. Note: `observations < seen_count` is legal (a consumer assuming otherwise will silently drop valid rows) |
| `first_seen_date` | ISO 8601 date | YYYY-MM-DD | Yes | Date of first observation |
| `last_seen_date` | ISO 8601 date | YYYY-MM-DD | Yes | Date of most recent observation |
| `source` | Enum | survey, gamefile, community | Yes | Discovery provenance |

**Constraints**:
- `additionalProperties: false` — No extra fields allowed
- No `updated_by` (pooled observations)

### pins.json

Curated points of interest. Pins are human-edited and may carry curation
attribution.

**Schema**: Array of objects.

**Item fields**:
| Field | Type | Unit/Constraint | Required | Notes |
|-------|------|-----------------|----------|-------|
| `id` | UUID | — | Yes | Stable identifier |
| `label` | String | — | Yes | Human-readable name; max 128 chars |
| `type` | String | — | Yes | Pin type (e.g., settlement, dungeon, shrine) |
| `category` | String | — | Yes | Broader category (e.g., town, cave, religious) |
| `map_x`, `map_y` | Number | Canvas pixels | Yes | 2D map canvas coordinates |
| `source` | Enum | survey, gamefile, community | Yes | Pin provenance |
| `world_x`, `world_y`, `world_z` | Number | Metres | No | World position if known; quantised to 1 m |
| `meta` | Object | — | No | Optional metadata (see below) |
| `updated_by` | Enum | seed, gamefiles, community | No | Curation source (pins only; required value set) |

**Meta subobject** (optional; `additionalProperties: false`):
| Field | Type | Notes |
|-------|------|-------|
| `position_source` | String | How position was derived |
| `poi_id` | String | External POI database ID |
| `poi_class` | String | External classification |
| `package` | String | Game package name |
| `anchor` | String | Specific bone or point on object |
| `instances` | Integer | Number of distinct simultaneous instances at this location; ≥1 if present. Example: a spawn point with three characters at once yields `instances = 3` |
| `spread_m` | Number | Spatial spread in metres |

**Constraints**:
- `additionalProperties: false` at pin and meta level
- `updated_by` is optional but if present must be one of `{seed, gamefiles, community}`
- `updated_by` is the *only* field allowed to carry human-curation attribution

### coverage.json

Map coverage: which grid cells have been visited and how many observations were
made in each.

**Schema**: Object.

**Fields**:
| Field | Type | Unit/Constraint | Required | Notes |
|-------|------|-----------------|----------|-------|
| `cell_size_m` | Integer | Metres | Yes | Grid cell size; typically 1000 |
| `cells` | Array | — | Yes | List of visited cells |

**Cell object** (`additionalProperties: false`):
| Field | Type | Unit | Required | Notes |
|-------|------|------|----------|-------|
| `x` | Integer | Grid index | Yes | Column |
| `y` | Integer | Grid index | Yes | Row |
| `rows` | Integer | Count | Yes | Total observations in this cell |

### manifest.json

Export metadata and summary statistics.

**Schema**: Object.

**Fields**:
| Field | Type | Value/Constraint | Required | Notes |
|-------|------|-----------------|----------|-------|
| `schema_version` | String | "v1" | Yes | Contract version |
| `snapshot_date` | ISO 8601 date | YYYY-MM-DD | Yes | Export date |
| `counts` | Object | — | Yes | Summary counts (see below) |
| `gates_applied` | Array of String | — | Yes | Included categories; empty means all |
| `coverage` | Object | — | Yes | Coverage summary (see below) |
| `diff_vs_previous` | Object | — | No | Changes from prior snapshot |

**Counts subobject** (`additionalProperties: false`):
| Field | Type | Notes |
|-------|------|-------|
| `discoveries` | Integer | Total discoveries in snapshot |
| `pins` | Integer | Total pins in snapshot |
| `by_kind` | Object | Counts of discoveries per kind enum |

**Coverage subobject** (`additionalProperties: false`):
| Field | Type | Notes |
|-------|------|-------|
| `visited_cells` | Integer | Grid cells with observations |
| `bbox_cells` | Integer | Cells in bounding box |
| `percent` | Number | Coverage percentage (0–100) |

**Diff subobject** (optional; `additionalProperties: false`):
| Field | Type | Notes |
|-------|------|-------|
| `added` | Integer | New discoveries or pins |
| `removed` | Integer | Deleted discoveries or pins |

## Validator Enforcement

The validator (`bin/validate-snapshot.mjs`) enforces this contract. It exits 0
on pass and non-zero on failure, reporting all violations in a single run.

Violations detected:
- Missing required fields
- Unexpected additional fields
- Type mismatches (UUID format, integer bounds, enum membership)
- Sub-day timestamp precision
- Date format violations

## Units Reference

- **World coordinates** (discoveries, pins optional): Unreal Engine world metres,
  quantised to 1 m
- **Canvas coordinates** (pins map_x, map_y): 2D image pixels on the exported map
  canvas
- **Grid cells**: Cell size defined per-snapshot (typically 1000 m); x and y are
  grid indices

## Enum Values Reference

### source (discoveries and pins)
- `survey` — Observed during gameplay
- `gamefile` — Extracted from game data files
- `community` — Contributed by players

### kind (discoveries only)
- `spawn` — Spawn point or respawn location
- `resource` — Gatherable resource node
- `container` — Chest, crate, or other container
- `npc` — Non-player character or merchant
- `structure` — Building, wall, or permanent structure

### updated_by (pins only, if present)
- `seed` — From initial seeding or automated tooling
- `gamefiles` — Extracted from game data or asset names
- `community` — Curated or contributed by community members
