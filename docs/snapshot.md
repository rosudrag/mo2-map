# Snapshot Contract v1

The snapshot export format captures surveyed discoveries and curated points-of-interest, with metadata about coverage and collection. This document defines the contract enforced by the validator.

## Overview

A snapshot is a directory containing four JSON files:
- `discoveries.json` — Machine-observed game objects (anonymous, no attribution)
- `pins.json` — Curated catalogue of significant locations (may carry provenance)
- `coverage.json` — Survey progress: cells scanned and their count
- `manifest.json` — Collection metadata: export date, gates applied, summary counts

## Privacy and Precision Rules

### Forbidden Fields (Denylist)

These fields MUST NOT appear in any snapshot:
- `owner`, `seq`, `cell_x`, `cell_y` — Database internal state; leaks row identity
- `status`, `note`, `meta_json` — Audit or task state (tracks collection work)
- `first_seen_at`, `last_seen_at` — Sub-day timestamps; see precision rule below
- `api_key`, `user`, `account`, `ip` — Personally-identifying information

Rationale: The snapshot runs in a public repository. The validator is the enforcement boundary: the thing that can leak must not be the thing that decides whether it leaked.

### Day Granularity (Temporal Precision)

Date fields MUST be in `YYYY-MM-DD` format only. No sub-day precision (hours, minutes, seconds, or milliseconds). This rule enforces through two layers:

1. **Broad scan**: All strings in the snapshot are checked for ISO 8601 full timestamps (`YYYY-MM-DD[T ]HH:MM:...`). This catches accidental leakage to any field.
2. **Strict enforcement**: Date fields (`first_seen_date`, `last_seen_date`, `snapshot_date`) use strict validation requiring exactly 8601-date format with no time component.

Rationale: Per-row sub-day timestamps across thousands of surveyed objects permit reconstruction of an individual's activity sessions, movement history, and behavior patterns over time. Day-level granularity preserves freshness signals and respawn-analysis value while eliminating the activity pattern leak.

Bare times in free-text fields (e.g., label `"12:30 meeting"`) are permitted; they do not reconstruct activity because they lack a date component.

## Files

### discoveries.json

Array of machine-observed game objects. Discoveries are anonymous—they carry no human attribution or edit history.

**Schema**: Array of objects.

**Item fields**:
| Field | Type | Unit/Constraint | Required | Notes |
|-------|------|-----------------|----------|-------|
| `id` | UUID | — | Yes | Stable identifier; format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `kind` | Enum | spawn, resource, container, npc, structure | Yes | Object category |
| `class_name` | String | — | Yes | Unreal engine class; max 160 chars (e.g., `BP_Camp_T2_C`) |
| `label` | String | — | Yes | Human-readable name; max 128 chars |
| `world_x`, `world_y`, `world_z` | Number | Metres | Yes | World position; quantised to 1 m |
| `seen_count` | Integer | — | Yes | Number of separate observations of this object; ≥1 |
| `observations` | Integer | — | Yes | Total observation events; ≥1 |
| `first_seen_date` | ISO 8601 date | YYYY-MM-DD | Yes | Date of first observation |
| `last_seen_date` | ISO 8601 date | YYYY-MM-DD | Yes | Date of most recent observation |
| `source` | Enum | survey, gamefile, community | Yes | Discovery provenance |

**Constraints**:
- `additionalProperties: false` — No extra fields allowed
- No `updated_by` (discoveries are anonymous machine observations)
- No forbidden fields

### pins.json

Array of curated points-of-interest. Pins are a human-edited catalogue; they may carry attribution to reflect curation provenance.

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
| `instances` | Integer | Spawn count if applicable |
| `spread_m` | Number | Spatial spread in metres |

**Constraints**:
- `additionalProperties: false` at pin and meta level
- `updated_by` is optional but if present must be one of `{seed, gamefiles, community}`
- `updated_by` is the *only* field allowed to carry human-curation attribution; it is forbidden on discoveries

### coverage.json

Survey coverage: which grid cells were scanned and how many observation events occurred in each.

**Schema**: Object.

**Fields**:
| Field | Type | Unit/Constraint | Required | Notes |
|-------|------|-----------------|----------|-------|
| `cell_size_m` | Integer | Metres | Yes | Grid cell size; typically 1000 |
| `cells` | Array | — | Yes | List of surveyed cells |

**Cell object** (`additionalProperties: false`):
| Field | Type | Unit | Required | Notes |
|-------|------|------|----------|-------|
| `x` | Integer | Grid index | Yes | Column |
| `y` | Integer | Grid index | Yes | Row |
| `rows` | Integer | Count | Yes | Observation events in this cell |

### manifest.json

Collection metadata and summary statistics.

**Schema**: Object.

**Fields**:
| Field | Type | Value/Constraint | Required | Notes |
|-------|------|-----------------|----------|-------|
| `schema_version` | String | "v1" | Yes | Contract version |
| `snapshot_date` | ISO 8601 date | YYYY-MM-DD | Yes | Export date |
| `counts` | Object | — | Yes | Summary counts (see below) |
| `gates_applied` | Array of String | — | Yes | List of filter names (may be empty) |
| `coverage` | Object | — | Yes | Coverage summary (see below) |
| `diff_vs_previous` | Object | — | No | Changes from prior snapshot (see below) |

**Counts subobject** (`additionalProperties: false`):
| Field | Type | Notes |
|-------|------|-------|
| `discoveries` | Integer | Total discoveries in snapshot |
| `pins` | Integer | Total pins in snapshot |
| `by_kind` | Object | Counts of discoveries per kind enum |

**Coverage subobject** (`additionalProperties: false`):
| Field | Type | Notes |
|-------|------|-------|
| `surveyed_cells` | Integer | Grid cells scanned |
| `bbox_cells` | Integer | Cells in bounding box |
| `percent` | Number | Coverage percentage (0–100) |

**Diff subobject** (optional; `additionalProperties: false`):
| Field | Type | Notes |
|-------|------|-------|
| `added` | Integer | New discoveries or pins |
| `removed` | Integer | Deleted discoveries or pins |

## Validator Enforcement

The validator (`bin/validate-snapshot.mjs`) is the enforcement boundary. It runs in this public repository precisely because it cannot be coerced to accept what it should not: the code is not under control of the snapshot producer.

The validator exits 0 on pass and non-zero on failure, reporting all violations in a single run (batch error reporting, not one-at-a-time round-trips).

Violations detected:
- Missing required fields
- Unexpected additional fields
- Type mismatches (UUID format, integer bounds, enum membership)
- Forbidden fields present
- Sub-day timestamp precision
- Date format violations

## Units Reference

- **World coordinates** (discoveries, pins optional): Unreal Engine world metres, quantised to 1 m
- **Canvas coordinates** (pins map_x, map_y): 2D image pixels on the exported map canvas
- **Grid cells**: Cell size defined per-snapshot (typically 1000 m); x and y are grid indices

## Enum Values Reference

### source (discoveries and pins)
- `survey` — Observed during gameplay survey
- `gamefile` — Extracted from game data files (unofficial datamining)
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
