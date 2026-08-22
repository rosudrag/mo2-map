# Snapshot Contract v3

A snapshot is a published dataset of places and things found on the game map.
The data is structured as JSON with a fixed field list, day-level date
precision, and no field that reconstructs collection activity.

## Overview

A snapshot is a directory containing two JSON files:
- `points.json` — every published point, one flat catalogue in a single closed
  category vocabulary
- `manifest.json` — export metadata: map id, schema version, generated date,
  the category/group taxonomy, and per-category counts

v2 published three files, split by *which pipeline produced a row* rather than
by what the row meant: `discoveries.json` (grid-surveyed spawns/resources/
npcs/structures/containers, 5 kinds) and `pins.json` (points extracted from
the game's own files, 42 category slugs) were independently produced, shared
no id scheme, no position convention and no vocabulary, and neither carried a
`map` field connecting an interior point to the dungeon level it was on. v1,
before that, also published `coverage.json`, a survey-progress grid recording
which cells had been visited and how often. It was retired in v2: a coverage
grid *is* collection-activity metadata — reconstructing it from anything else
a snapshot ships would defeat the point of removing the rest.

v3 collapses the two pipelines into one row shape. A point extracted from the
game's own files and a point built from a field survey now carry the same
eight possible keys and draw their category from the same closed list — the
distinction between "curated" and "discovered" is not part of the published
contract, because a reader filtering by "Towns" or "Resources" has no reason
to know or care which pipeline found the row.

## Version history

- **v1** shipped `coverage.json` alongside its point data — a grid recording
  which cells had been visited and how often. Retired in v2: it is itself a
  record of where someone looked, not what is on the map.
- **v2** split the catalogue into `discoveries.json` (grid-aggregated,
  5-value `kind` enum, 8-hex hashed `id`, integer world metres) and
  `pins.json` (42 ad-hoc category slugs, each *derived by slugifying that
  row's own label text* rather than declared anywhere, non-hash `id` like
  `beth-jedda-bank-2`, both canvas pixels and world metres on every row). No
  shared vocabulary, no shared id scheme, no `map` field. 3,953 points across
  the two files, 454 KB.
- **v3** (this document) merges both pipelines into one file and one row
  shape, and moves the category vocabulary out of the rows and into
  `manifest.json`, declared once instead of reconstructed per row. Adds the
  `map`/`dungeon` fields a level-aware reader needs, drops the duplicate
  canvas-pixel position, and removes several classes of noise measured in the
  underlying survey (see "What the sanitisation removed" below). 1,977
  points, one file, 154 KB.

## Files

### points.json

**Schema**: Array of objects. `additionalProperties: false` — no field may
appear beyond the eight below.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | 8 lowercase hex chars | Yes | `sha256("cat\|name\|x\|y")[0:8]`. One id scheme for every row regardless of which pipeline produced it — v2 mixed 8-hex hashes (`discoveries.json`) with slugs like `beth-jedda-bank-2` (`pins.json`); a reader could not tell from the `id` alone what kind of row they were looking at, or rely on it having a fixed length. |
| `cat` | Enum, 37 values in 7 groups | Yes | See "The closed vocabulary" below. Replaces v2's `kind` (5 values, `discoveries.json` only) and `category`/`type` (42 slugs, `pins.json` only, invented per row — see "Version history"). |
| `name` | String, non-empty, ≤128 chars | Yes | A folded human name, never an engine class token — the same rule v2's `label` enforced. |
| `x`, `y` | Integer, world metres | Yes | The ONLY published position. v2 published both world metres and canvas pixels (`map_x`/`map_y`) on every pin; measured over all 397 v2 pins the two never disagreed by more than 0.064 px, so `map_x`/`map_y` was 21 KB of a second truth that could drift from the first rather than 21 KB of extra information. A consumer derives canvas pixels from `x`/`y` with the transform in `docs/coordinates.md`. |
| `n` | Integer ≥ 2 | Omitted when 1 | How many things are at this point — not how many times it was seen. Present only when there is something to say; a lone point carries no `n` at all, rather than v2's `count`, which was required on every `discoveries.json` row and read `1` on the majority of them. |
| `map` | String | Present only on `interior`-group points | The level a point belongs to, e.g. `"sarducaa/argkepher/1"`. Omitted means the surface. v2 had no equivalent field at all — see "Bugs fixed" below for what that broke. |
| `dungeon` | String, `^[a-z0-9_]+$` | Present on `dungeon`, `entrance` and `interior`-group points | Which of the four dungeons (`argkepher`, `jungle`, `tuzsaltmines`, `yelkeskarhideout`) a point belongs to. New in v3, and the field to filter on for "everything about one dungeon" — it spans the dungeon itself, its surface doors and its interior contents, which are three different categories. |

**Fields that do not exist, and why:**

| Dropped field | Reason |
|---|---|
| `z` | v2 shipped `z` on 3,556 rows; the only consumer read it and discarded it. It stays load-bearing inside the producer — it is what separates the Haven tutorial island's rows from Sarducaa's (see "Wrong continent" below) — but that is a production-time filter, not a fact this snapshot publishes. |
| `kind`, `type`, `category`, `label`, `cls`, `class_name`, `className` | Folded into `cat` and `name`. A published `cls`/`class_name` is an engine identifier, not a fact about the map — forbidden below regardless of field name. |
| `map_x`, `map_y` | Canvas-pixel duplicate of `x`/`y` — see the `x`,`y` row above. |
| `world_x`, `world_y`, `world_z` | v2's alternate name for the same position on `pins.json` rows; collapsed into `x`/`y` (and `world_z` into the `map`/`dungeon` decision, not published — see `z` above). |
| `count` | Replaced by `n`, which is optional instead of always-present-at-minimum-1. |
| `first_seen`, `first_seen_at`, `first_seen_date`, `last_seen`, `last_seen_at`, `last_seen_date`, `observations`, `seen_count`, `server_id`, `serverId`, `published_count`, `published_observations`, `owner`, `seq`, `status`, `note`, `api_key`, `user`, `account`, `ip`, `updated_by`, `source` | Never published, at any nesting depth, in any version. Timestamps, sighting tallies, server/account identity and human-curation provenance are exactly what would let a reader reconstruct who found what, when — the snapshot publishes *what is on the map*, not *who mapped it*. |

### manifest.json

**Schema**: Object.

| Field | Type | Notes |
|---|---|---|
| `id` | String | Map identifier, `"sarducaa"` |
| `schema_version` | String | `"v3"` |
| `generated` | `YYYY-MM-DD` | Export date |
| `groups` | Array of `{ id, label }` | 7 rows, declaration order is display order |
| `categories` | Array of `{ id, label, group }` | 36 rows; `group` names one of the 7 group ids by reference |
| `counts.points` | Integer | Total row count in `points.json` |
| `counts.by_category` | Object | Integer count per category id — **every declared category is present, even at 0** (see "Known gaps" below) |

The manifest carries the taxonomy. That is deliberate, and it is the load-
bearing change in this version: v2's consumer had no vocabulary to read, so it
built one at load time by slugifying each row's own label text. That is
exactly how it ended up with 42 categories for 24 real concepts — `craft`
beside `crafting`, `extraction` beside `extractors`, four spellings of
trinkets, and a `north-exit` category that existed because one town plan
happened to have the words "north exit" printed on it. A v3 consumer reads
`categories`/`groups` from the manifest and never invents a category from row
text — there is exactly one place a category can be declared.

## The closed vocabulary

37 categories in 7 groups. Counts are `manifest.json`'s own
`counts.by_category`, read directly from the shipped file, not recomputed.

| Group | Category | Label | Count |
|---|---|---|---|
| Gathering | `resource` | Resources | 925 |
| Wildlife | `creature` | Creatures | 442 |
| Wildlife | `bandit` | Hostile humanoids | 61 |
| Wildlife | `camp` | Camps & lairs | 88 |
| Settlements | `town` | Towns | 8 |
| Settlements | `bank` | Banks | 15 |
| Settlements | `vendors` | Vendors | 58 |
| Settlements | `broker` | Brokers | 11 |
| Settlements | `guard` | Guards | 71 |
| Settlements | `stable` | Stables | 10 |
| Settlements | `postal` | Postal service | 10 |
| Settlements | `tasks` | Task givers | 21 |
| Settlements | `library` | Libraries | 3 |
| Settlements | `housing` | Housing | 2 |
| Settlements | `elevator` | Elevators | 4 |
| Settlements | `guild` | Guild stones | 6 |
| Settlements | `training` | Training | 1 |
| Crafting | `crafting` | Crafting benches | 51 |
| Crafting | `refining` | Refining | 27 |
| Crafting | `cooking` | Cooking | 24 |
| Crafting | `butchery` | Butchery | 9 |
| Crafting | `alchemy` | Alchemy & botany | 1 |
| Crafting | `trinkets` | Trinkets | 4 |
| Faith | `priest` | Priests | 28 |
| Faith | `spiritism` | Spiritism | 5 |
| Faith | `wayshrine` | Wayshrines | 7 |
| World | `dungeon` | Dungeons | 4 |
| World | `entrance` | Dungeon entrances | 12 |
| World | `ruins` | Ruins | 32 |
| World | `tower` | Supply towers | 11 |
| World | `landmark` | Landmarks | 4 |
| World | `cave` | Caves | 1 |
| Dungeon interior | `exit` | Ways out | 12 |
| Dungeon interior | `boss` | Boss rooms | 0 |
| Dungeon interior | `journal` | Journals | 4 |
| Dungeon interior | `lever` | Levers | 3 |
| Dungeon interior | `loot` | Loot | 2 |

`boss` legitimately reads 0 in this snapshot — see "Known gaps" below. It is
still a declared category, not an absent one: a consumer that drops a
zero-count category from its filter list rather than rendering it as an empty
row gets this right for free; a consumer that infers its category list from
`points.json` alone cannot represent `boss` at all.

`dungeon` and `entrance` are separate categories for a rendering reason worth
knowing if you build on this data: a dungeon is a place and gets a permanent
name on the map, while its three doors sit within ~500 m of it, so labelling
all four stacks four pieces of text on top of each other. Two categories state
"label the dungeon, not its doors" as data; one category plus a name heuristic
would state it as a guess. Both are on the surface and both carry the same
`dungeon` key, so a consumer that wants "everything about Arg Kepher" filters
on that key rather than on the category.

## What the sanitisation removed

v2 published 3,953 points across two files, 454 KB. v3 publishes 1,977 points
in one file, 154 KB. The cuts below are each measured and reported by the
producer on every export run — one row per rule, in the same "measure it,
don't assume it" style as the rest of this document.

| Rule | Rows removed | Measured basis |
|---|---|---|
| Wrong continent | 327 | v2 published 305 points from Haven, the tutorial island, as Sarducaa — 8.6% of its catalogue, including 91 of its 136 Granum rows. Sarducaa's rows sit in `z` ∈ [−407.2, +231.8]; Haven's in `z` ∈ [−1641.6, −1301.7] — an 894.5 m gap with nothing at all inside it. v2's only guard was a class-name regex that caught 18 of 1,569 raw Haven rows (1.1%). |
| Loot containers | 376 | Chest/urn/barrel/crate — 11% of v2's published catalogue, and the 2nd/3rd/5th most ubiquitous classes in the whole surveyed dataset (Chest present in 25.3% of surveyed 500 m patches, Barrel 19.5%, Urn 18.7%). |
| Ubiquitous classes | 3,032 | A class present in more than 15% of surveyed 500 m patches describes the species, not the map. v2 applied this test to plants only; v3 extends it to creatures — Jungle Horse (40.2% spread, and alone 10% of every point on v2's map), Ratzar Worker, Terrorbird, Desert Clothos Spider, Panther and Gamal Ruah. |
| Hostile humanoids near a camp | 92 | Within 300 m of a camp the game files already name — the camp's own position and faction were already published from an authoritative source, so a nearby individual humanoid added a pin without adding a fact. |
| Duplicate town-plan points | 80 | Standing on an extracted point that already said more. 160 of v2's 397 pins shared a position with another pin; 66 of its 125 town-plan pins (53%) sat on the exact pixel of an extracted pin — `Ashir Craft` under `Armour Bench` + `Bow Bench` + `Shield Bench`, `Beth Jedda Extractors` under `Crusher` + `Grinder` + `Grizzly`. |
| No level to file on | 37 rows + 4 extracted POIs | Measured to be inside a dungeon, but the source data names which dungeon without saying which level — withheld rather than drawn on the surface. See "Known gaps" below. |
| Loot props | 17 | Props, not containers — see "Loot containers" above for the class-level cut. |
| Event content | 3 | Rows tied to time-limited event content, not the standing map. |
| Engine placeholders | 9 | Rows whose own identity reduces to no name (e.g. a raw class of `PickableFieldInstance`) — tell a reader less than an absent row does. |
| Player remains | 8 | Character spirits and the boxes spiritism keeps them in — both record a person, not a place. |
| Player-built objects | 275 | Furniture, siege equipment and other things a player placed rather than the game. |
| Inside a player holding | 215 | Installed within a player-owned plot's footprint. |
| Pets | 933 | A creature parked in a town or on a holding is a pet or a mount, not a spawn point. |
| Not worth a pin | 48 | Judgement calls recorded as an explicit list because they cannot be re-derived from the data — see `docs/release-checklist.md`'s data-sanitisation entry for who made the call and why. |

**New in v3:** +8 town points. v2 shipped none — its pin catalogue had no
`town` category at all, so the eight settlements were raster plates carrying
zero point, zero label and zero search hit, and `Aur Bank` / `Aur Library`
could appear on the map without `Aur` itself ever appearing.

### Bugs fixed, not just noise removed

- **Wrong continent.** See the table above — this was a data-quality bug
  (8.6% of the published catalogue), not a judgement call.
- **The dead map gate.** Both consumers already implement a map-visibility
  check (`poi/markers.js`'s `markerVisible` → `onActiveMap`,
  `discoveries/state.js`'s `discoveryVisible`), but v2 shipped no `map` field
  for either check to read, so it could never fire: 25 dungeon-interior pins
  rendered on the surface, stacked on top of their own entrances, and no
  point could ever appear on a dungeon level's own plate. v3's `map`/
  `dungeon` fields are what that gate needed.
- **Duplicate town-plan pins.** See the table above.
- **`z` published and discarded.** v2 shipped `z` on 3,556 rows; the only
  consumer read it and threw it away. It is not part of the v3 contract (see
  the dropped-fields table above).

## Known gaps

These are stated honestly rather than papered over, because a map that hides
its own gaps is worse than one that names them:

**(a) Withheld interior content.** The four boss rooms and the 37 measured
interior survey rows noted above are not published, in this version or any
future one until the underlying data changes: the source knows which dungeon
a point is inside but not which level, and drawing an interior room at its
surface projection is a lie about where it is — the exact failure the `map`
field exists to prevent elsewhere. `boss` reading 0 in `counts.by_category`
is this gap, not a bug.

**(b) Absence is not evidence of absence.** A point on this map means
somebody found, surveyed or extracted that thing. Absence of a point means
*nobody has looked there* — only part of the island has ever been walked —
not that nothing is there. This snapshot ships no coverage grid (see
"Version history" — v1's `coverage.json`, retired for good reason), so
nothing in `points.json` or `manifest.json` lets a reader distinguish an
unexplored patch from an explored, genuinely empty one.

## Format Rules

### Forbidden Fields

The following never appear anywhere in a published file, at any nesting
depth: `first_seen`, `first_seen_at`, `first_seen_date`, `last_seen`,
`last_seen_at`, `last_seen_date`, `observations`, `seen_count`, `server_id`,
`serverId`, `published_count`, `published_observations`, `owner`, `seq`,
`status`, `note`, `api_key`, `user`, `account`, `ip`, `updated_by`, `source`,
`cls`, `class_name`, `className`, `z`, `kind`, `type`, `category`, `label`,
`map_x`, `map_y`, `world_x`, `world_y`, `world_z`, `count`. Timestamps,
sighting tallies, server/account identity, human-curation provenance, and
engine class identifiers are exactly what would let a reader reconstruct who
found what, when, and with what engine object — this snapshot publishes
*what is on the map*, not *who mapped it* or *what the game engine calls it*.

### Date Granularity

Dates use `YYYY-MM-DD` format only; no sub-day precision. The only date field
in the snapshot is `manifest.json`'s `generated`. The validator enforces the
rule with two checks:

1. **Broad scan**: every string in every file is checked for a full ISO 8601
   timestamp (`YYYY-MM-DD[T ]HH:MM:...`).
2. **Strict validation**: `generated` must be exactly `YYYY-MM-DD`.

Bare times in free-text fields (e.g., a label reading `"12:30 meeting"`) are
allowed; they lack a date component.

## Validator Enforcement

The validator (`bin/validate-snapshot.mjs`) enforces this contract. It exits
0 on pass and non-zero on failure, reporting all violations in a single run.

Violations detected:
- Missing required fields
- Unexpected additional fields
- Type mismatches (`id` format, integer bounds, `cat` enum membership against
  the manifest's own declared categories)
- Forbidden fields, anywhere, at any nesting depth
- A `name` that looks like a raw engine class name instead of a folded human
  name
- `map`/`dungeon` present or absent inconsistently with a point's own `cat`
  group membership
- Sub-day timestamp precision
- Date format violations

## Units Reference

- **World coordinates** (`points.json`'s `x`, `y`): Unreal Engine world
  metres, integer.
- **Canvas coordinates**: not published. A consumer derives them from `x`/`y`
  with the transform documented in `docs/coordinates.md`.
