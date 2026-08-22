#!/usr/bin/env node

import fs from "fs";
import path from "path";

/*
 * Snapshot validator: structure, field list, taxonomy, and timestamp precision.
 *
 * Enforces the v3 snapshot contract: files match the schema, contain only
 * specified fields, and carry no field that reconstructs collection
 * activity (who found what, when, how often) or leaks an engine identifier.
 * v3 merges what used to be two files (discoveries.json, pins.json) into
 * one points.json, and moves the category taxonomy out of the row shape
 * and into manifest.json — see snapshot/v3/schema.json for the full
 * contract and the measurements behind each rule. Exit 0 on pass, non-zero
 * on failure. Reports all violations in a single run.
 */

// Forbidden anywhere in any published file, at any nesting depth. This is
// the exact denylist from the shared snapshot contract — every field that
// would let a reader reconstruct collection activity (timestamps, sighting
// tallies, server/account identity), reintroduce human-curation provenance
// (source, updated_by), or carry an engine class identifier (cls and its
// class_name/className aliases). Unchanged from v2 — none of these were
// ever legal and v3 does not relax the list.
const FORBIDDEN_FIELDS = new Set([
  "first_seen",
  "first_seen_at",
  "first_seen_date",
  "last_seen",
  "last_seen_at",
  "last_seen_date",
  "observations",
  "seen_count",
  "server_id",
  "serverId",
  "published_count",
  "published_observations",
  "owner",
  "seq",
  "status",
  "note",
  "api_key",
  "user",
  "account",
  "ip",
  "updated_by",
  "source",
  "cls",
  "class_name",
  "className"
]);

// Forbidden specifically on points.json rows: every field the v3 row shape
// dropped. Checked only against points.json, never against manifest.json —
// manifest.json legitimately carries a "label" on every group/category
// entry (see the real file: "categories": [{"id": "resource", "label":
// "Resources", ...}, ...]); the same word means something different one
// level up, a display string for a taxonomy entry, not a per-row name.
//   - z: the vertical split the private producer uses to tell Sarducaa from
//     the Haven tutorial island apart; the only public consumer read it and
//     threw it away, so it never earned a place in the published contract.
//   - kind/type/category/label/count: the v2 row-shape vocabulary that
//     points.json's cat/name/n replace.
//   - map_x/map_y/world_x/world_y/world_z: v2 published canvas pixels AND
//     world metres on every pin; measured over all 397 v2 pins the two
//     never disagreed by more than 0.064px, so one was 21KB of a second
//     truth that could only drift. v3 publishes x/y (world metres) alone;
//     the consumer derives canvas pixels.
const POINT_ONLY_FORBIDDEN_FIELDS = new Set([
  "z",
  "kind",
  "type",
  "category",
  "label",
  "count",
  "map_x",
  "map_y",
  "world_x",
  "world_y",
  "world_z"
]);

// Timestamp precision check: day-granularity enforcement via two layers.
// Layer 1 (this regex): scan all strings for full ISO date-times (YYYY-MM-DD[T ]digits).
// Layer 2 (isValidDate): manifest.json's `generated` field must be exactly
// YYYY-MM-DD format, rejecting any time component.
// Bare times in free-text fields (e.g., name) are permitted.
const TIMESTAMP_PRECISION_REGEX = /\d{4}-\d{2}-\d{2}[T ]\d/;

// Closed category vocabulary: one entry per legal `cat` value, mapped to
// its group exactly as manifest.json's own "categories" array declares it.
// This table is the enforcement half of the taxonomy the manifest carries
// — the manifest is the *published* source of truth (a consumer reads it,
// never invents a vocabulary by slugifying names, which is how v2 ended up
// with 42 categories for 24 concepts); this table is what lets the
// validator hold manifest.json itself to that same taxonomy. Order matches
// the exporter's manifest.json emission order, so a diff against the real
// file is a diff against this table.
const GROUPS = ["gathering", "wildlife", "settlement", "crafting", "faith", "world", "interior"];

const CATEGORY_GROUP = {
  resource: "gathering",
  creature: "wildlife",
  bandit: "wildlife",
  camp: "wildlife",
  town: "settlement",
  bank: "settlement",
  vendors: "settlement",
  broker: "settlement",
  guard: "settlement",
  stable: "settlement",
  postal: "settlement",
  tasks: "settlement",
  library: "settlement",
  housing: "settlement",
  elevator: "settlement",
  guild: "settlement",
  training: "settlement",
  crafting: "crafting",
  refining: "crafting",
  cooking: "crafting",
  butchery: "crafting",
  alchemy: "crafting",
  trinkets: "crafting",
  priest: "faith",
  spiritism: "faith",
  wayshrine: "faith",
  dungeon: "world",
  entrance: "world",
  ruins: "world",
  tower: "world",
  landmark: "world",
  cave: "world",
  exit: "interior",
  boss: "interior",
  journal: "interior",
  lever: "interior",
  loot: "interior"
};

// Points in this group sit *inside* a dungeon level, not on the surface
// plate: the map gate both consumers already implement (poi/markers.js's
// onActiveMap, discoveries/state.js's discoveryVisible) needs `map` to
// know which level to draw them on, and v2 never published it — 25
// dungeon-interior pins rendered stacked on their surface entrances. The
// `dungeon` category's own point (the world-group entrance marker) is on
// the surface, so it carries `dungeon` (which dungeon it opens into) but
// never `map`.
const INTERIOR_CATEGORIES = new Set(
  Object.keys(CATEGORY_GROUP).filter((cat) => CATEGORY_GROUP[cat] === "interior")
);

const POINT_ID_REGEX = /^[0-9a-f]{8}$/;

// <continent>/<dungeon>/<level>, e.g. "sarducaa/argkepher/1" — the level
// path a consumer needs to know which plate to draw the point on.
const MAP_REGEX = /^[a-z0-9]+\/[a-z0-9_]+\/[0-9]+$/;
const DUNGEON_KEY_REGEX = /^[a-z0-9_]+$/;

// A published name is a folded human name, never a raw engine class token.
// Class tokens are code identifiers: underscore-joined segments with no
// spaces (BP_Ore_Iron_C, HerbNode_FicosLeaves, T_Rock_LOD1_D). Folded human
// names always contain a space (or at most a bare hyphen, e.g. "Tier-2
// Camp") — so "made only of underscore-joined word characters" reliably
// flags a leaked class name without rejecting a legitimate folded name.
const CLASS_NAME_LEAK_REGEX = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$/;

class Validator {
  constructor(dir) {
    this.dir = dir;
    this.violations = [];
    // Populated by validatePoints() when points.json parses as an array,
    // even if individual rows fail their own checks — validateManifest()
    // needs the raw row count and per-category tally to cross-check
    // counts.points / counts.by_category against reality.
    this.points = null;
  }

  violation(file, jsonPath, message) {
    this.violations.push({ file, jsonPath, message });
  }

  validate() {
    this.validatePoints();
    this.validateManifest();

    return {
      passed: this.violations.length === 0,
      violations: this.violations
    };
  }

  readJsonFile(filename) {
    const filepath = path.join(this.dir, filename);
    try {
      const content = fs.readFileSync(filepath, "utf8");
      return JSON.parse(content);
    } catch (e) {
      this.violation(filename, "$", `Failed to read/parse: ${e.message}`);
      return null;
    }
  }

  // Recursively check for forbidden fields anywhere in the data structure.
  checkForbiddenFields(data, filename, jsonPath, fields) {
    if (data === null || data === undefined) return;

    if (typeof data === "object") {
      if (Array.isArray(data)) {
        data.forEach((item, idx) => {
          this.checkForbiddenFields(item, filename, `${jsonPath}[${idx}]`, fields);
        });
      } else {
        for (const [key, value] of Object.entries(data)) {
          const currentPath = `${jsonPath}.${key}`;

          if (fields.has(key)) {
            this.violation(
              filename,
              currentPath,
              `Forbidden field '${key}' present`
            );
          }

          // Recursively check nested structures
          this.checkForbiddenFields(value, filename, currentPath, fields);
        }
      }
    }
  }

  // Check for sub-day timestamp precision in any string anywhere
  checkTimestampPrecision(data, filename, jsonPath = "$") {
    if (data === null || data === undefined) return;

    if (typeof data === "string") {
      if (TIMESTAMP_PRECISION_REGEX.test(data)) {
        this.violation(
          filename,
          jsonPath,
          `String contains sub-day timestamp precision: '${data}' (must be day granularity YYYY-MM-DD)`
        );
      }
    } else if (typeof data === "object") {
      if (Array.isArray(data)) {
        data.forEach((item, idx) => {
          this.checkTimestampPrecision(item, filename, `${jsonPath}[${idx}]`);
        });
      } else {
        for (const [key, value] of Object.entries(data)) {
          this.checkTimestampPrecision(
            value,
            filename,
            `${jsonPath}.${key}`
          );
        }
      }
    }
  }

  validatePoints() {
    const data = this.readJsonFile("points.json");
    if (!data) return;

    if (!Array.isArray(data)) {
      this.violation("points.json", "$", "Root must be an array");
      return;
    }

    this.points = data;

    // id must be unique across the whole file — v2's id scheme mixed
    // 8-hex discovery ids with slug pin ids and never checked either for
    // collisions; v3 has one id scheme, so a collision is always a bug.
    const firstSeenAt = new Map();
    data.forEach((item, idx) => {
      const jsonPath = `$[${idx}]`;
      this.validatePointItem(item, jsonPath);

      if (item && typeof item === "object" && typeof item.id === "string") {
        if (firstSeenAt.has(item.id)) {
          this.violation(
            "points.json",
            `${jsonPath}.id`,
            `duplicate id '${item.id}' (first seen at $[${firstSeenAt.get(item.id)}])`
          );
        } else {
          firstSeenAt.set(item.id, idx);
        }
      }
    });

    this.checkForbiddenFields(data, "points.json", "$", FORBIDDEN_FIELDS);
    this.checkForbiddenFields(data, "points.json", "$", POINT_ONLY_FORBIDDEN_FIELDS);
    this.checkTimestampPrecision(data, "points.json");
  }

  validatePointItem(item, jsonPath) {
    const filename = "points.json";

    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      this.violation(filename, jsonPath, "Item must be an object");
      return;
    }

    const required = ["id", "cat", "name", "x", "y"];
    const optional = ["n", "map", "dungeon"];
    const allowed = new Set([...required, ...optional]);

    for (const field of required) {
      if (!(field in item)) {
        this.violation(filename, jsonPath, `Missing required field '${field}'`);
      }
    }

    for (const key of Object.keys(item)) {
      if (!allowed.has(key)) {
        this.violation(
          filename,
          `${jsonPath}.${key}`,
          `Unexpected property '${key}' (additionalProperties: false)`
        );
      }
    }

    // id: sha256("cat|name|x|y")[0:8], uniform for every point regardless
    // of which pipeline produced it.
    if (item.id !== undefined && typeof item.id !== "string") {
      this.violation(filename, `${jsonPath}.id`, "id must be a string");
    }
    if (typeof item.id === "string" && !POINT_ID_REGEX.test(item.id)) {
      this.violation(filename, `${jsonPath}.id`, "id must be 8 lowercase hex characters");
    }

    // cat: closed vocabulary, not a free-text slug — see CATEGORY_GROUP.
    if (item.cat !== undefined && typeof item.cat !== "string") {
      this.violation(filename, `${jsonPath}.cat`, "cat must be a string");
    } else if (typeof item.cat === "string" && !(item.cat in CATEGORY_GROUP)) {
      this.violation(
        filename,
        `${jsonPath}.cat`,
        `cat must be one of the declared category vocabulary, got '${item.cat}'`
      );
    }

    if (item.name !== undefined && (typeof item.name !== "string" || item.name.length === 0)) {
      this.violation(filename, `${jsonPath}.name`, "name must be a non-empty string");
    }
    if (typeof item.name === "string" && item.name.length > 128) {
      this.violation(filename, `${jsonPath}.name`, "name must be ≤128 characters");
    }
    if (typeof item.name === "string" && CLASS_NAME_LEAK_REGEX.test(item.name)) {
      this.violation(
        filename,
        `${jsonPath}.name`,
        `name looks like a raw engine class name, not a folded human name: '${item.name}'`
      );
    }

    // Coordinates: integer world metres — the only published position (see
    // POINT_ONLY_FORBIDDEN_FIELDS above for why map_x/map_y/world_* are gone).
    for (const axis of ["x", "y"]) {
      if (item[axis] !== undefined && (typeof item[axis] !== "number" || !Number.isInteger(item[axis]))) {
        this.violation(filename, `${jsonPath}.${axis}`, `${axis} must be an integer`);
      }
    }

    // n: how many things sit at this point. Omitted entirely when 1 — a
    // present n of 1 means the producer forgot to omit it, not that there
    // is one of something.
    if (item.n !== undefined) {
      if (typeof item.n !== "number" || !Number.isInteger(item.n)) {
        this.violation(filename, `${jsonPath}.n`, "n must be an integer");
      } else if (item.n < 2) {
        this.violation(
          filename,
          `${jsonPath}.n`,
          "n must be ≥2 (a point count of 1 is implicit — omit n instead)"
        );
      }
    }

    if (item.map !== undefined && (typeof item.map !== "string" || !MAP_REGEX.test(item.map))) {
      this.violation(
        filename,
        `${jsonPath}.map`,
        "map must match '<continent>/<dungeon>/<level>' (e.g. 'sarducaa/argkepher/1')"
      );
    }

    if (item.dungeon !== undefined && (typeof item.dungeon !== "string" || !DUNGEON_KEY_REGEX.test(item.dungeon))) {
      this.violation(filename, `${jsonPath}.dungeon`, "dungeon must match ^[a-z0-9_]+$");
    }

    // Interior/dungeon gating — only meaningful once cat resolves to a
    // known category; an already-reported bad cat doesn't also need a
    // confusing map/dungeon complaint layered on top of it.
    if (typeof item.cat === "string" && item.cat in CATEGORY_GROUP) {
      const isInterior = INTERIOR_CATEGORIES.has(item.cat);
      const requiresDungeon = item.cat === "dungeon" || item.cat === "entrance" || isInterior;

      if (isInterior && !("map" in item)) {
        this.violation(
          filename,
          jsonPath,
          "Missing required field 'map' (every interior-group point must carry the dungeon level it belongs to)"
        );
      } else if (!isInterior && "map" in item) {
        this.violation(
          filename,
          `${jsonPath}.map`,
          `'map' is only valid on interior-group categories (exit/boss/journal/lever/loot); '${item.cat}' is not one of them`
        );
      }

      if (requiresDungeon && !("dungeon" in item)) {
        this.violation(filename, jsonPath, "Missing required field 'dungeon'");
      } else if (!requiresDungeon && "dungeon" in item) {
        this.violation(
          filename,
          `${jsonPath}.dungeon`,
          `'dungeon' is only valid on the 'dungeon' category and interior-group categories; '${item.cat}' is not one of them`
        );
      }
    }
  }

  validateManifest() {
    const data = this.readJsonFile("manifest.json");
    if (!data) return;

    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      this.violation("manifest.json", "$", "Root must be an object");
      return;
    }

    const required = ["id", "schema_version", "generated", "groups", "categories", "counts"];
    const allowed = new Set(required);

    for (const field of required) {
      if (!(field in data)) {
        this.violation("manifest.json", "$", `Missing required field '${field}'`);
      }
    }

    for (const key of Object.keys(data)) {
      if (!allowed.has(key)) {
        this.violation(
          "manifest.json",
          `$.${key}`,
          `Unexpected property '${key}' (additionalProperties: false)`
        );
      }
    }

    if (data.id !== undefined && typeof data.id !== "string") {
      this.violation("manifest.json", "$.id", "id must be a string");
    }

    // schema_version is a literal, not a range — a consumer that reads
    // "v3" is reading exactly this contract, never a compatible-ish one.
    if (data.schema_version !== undefined && data.schema_version !== "v3") {
      this.violation("manifest.json", "$.schema_version", "schema_version must be exactly 'v3'");
    }

    if (data.generated !== undefined && !isValidDate(data.generated)) {
      this.violation("manifest.json", "$.generated", "generated must be YYYY-MM-DD format");
    }

    const declaredGroupIds = this.validateManifestGroups(data.groups);
    this.validateManifestCategories(data.categories, declaredGroupIds);
    this.validateManifestCounts(data.counts);

    this.checkForbiddenFields(data, "manifest.json", "$", FORBIDDEN_FIELDS);
    this.checkTimestampPrecision(data, "manifest.json");
  }

  // Validates manifest.json's "groups" array against the canonical GROUPS
  // list — the manifest is the published taxonomy, so it must match the
  // vocabulary the validator (and every downstream consumer) enforces, not
  // some other 7 group ids that happen to also be legal-looking strings.
  validateManifestGroups(groups) {
    if (groups === undefined) return null;
    if (!Array.isArray(groups)) {
      this.violation("manifest.json", "$.groups", "groups must be an array");
      return null;
    }

    const seen = new Set();
    groups.forEach((group, idx) => {
      const jsonPath = `$.groups[${idx}]`;
      if (typeof group !== "object" || group === null || Array.isArray(group)) {
        this.violation("manifest.json", jsonPath, "group entry must be an object");
        return;
      }

      for (const field of ["id", "label"]) {
        if (!(field in group)) {
          this.violation("manifest.json", jsonPath, `Missing required field '${field}'`);
        }
      }
      for (const key of Object.keys(group)) {
        if (key !== "id" && key !== "label") {
          this.violation(
            "manifest.json",
            `${jsonPath}.${key}`,
            `Unexpected property '${key}' (additionalProperties: false)`
          );
        }
      }

      if (group.id !== undefined && typeof group.id !== "string") {
        this.violation("manifest.json", `${jsonPath}.id`, "id must be a string");
      }
      if (group.label !== undefined && (typeof group.label !== "string" || group.label.length === 0)) {
        this.violation("manifest.json", `${jsonPath}.label`, "label must be a non-empty string");
      }

      if (typeof group.id === "string") {
        if (seen.has(group.id)) {
          this.violation("manifest.json", `${jsonPath}.id`, `group '${group.id}' is declared more than once`);
        }
        seen.add(group.id);
      }
    });

    for (const id of GROUPS) {
      if (!seen.has(id)) {
        this.violation("manifest.json", "$.groups", `manifest is missing required group '${id}'`);
      }
    }
    for (const id of seen) {
      if (!GROUPS.includes(id)) {
        this.violation("manifest.json", "$.groups", `manifest declares undeclared group '${id}'`);
      }
    }

    return seen;
  }

  // Validates manifest.json's "categories" array against CATEGORY_GROUP —
  // both the set of ids (every category must be declared, nothing extra)
  // and each declared group (a category filed under the wrong group would
  // silently mis-file it in a consumer's filter UI).
  validateManifestCategories(categories, declaredGroupIds) {
    if (categories === undefined) return null;
    if (!Array.isArray(categories)) {
      this.violation("manifest.json", "$.categories", "categories must be an array");
      return null;
    }

    const seen = new Map(); // id -> declared group
    categories.forEach((category, idx) => {
      const jsonPath = `$.categories[${idx}]`;
      if (typeof category !== "object" || category === null || Array.isArray(category)) {
        this.violation("manifest.json", jsonPath, "category entry must be an object");
        return;
      }

      for (const field of ["id", "label", "group"]) {
        if (!(field in category)) {
          this.violation("manifest.json", jsonPath, `Missing required field '${field}'`);
        }
      }
      for (const key of Object.keys(category)) {
        if (key !== "id" && key !== "label" && key !== "group") {
          this.violation(
            "manifest.json",
            `${jsonPath}.${key}`,
            `Unexpected property '${key}' (additionalProperties: false)`
          );
        }
      }

      if (category.id !== undefined && typeof category.id !== "string") {
        this.violation("manifest.json", `${jsonPath}.id`, "id must be a string");
      }
      if (category.label !== undefined && (typeof category.label !== "string" || category.label.length === 0)) {
        this.violation("manifest.json", `${jsonPath}.label`, "label must be a non-empty string");
      }
      if (category.group !== undefined && typeof category.group !== "string") {
        this.violation("manifest.json", `${jsonPath}.group`, "group must be a string");
      }

      if (typeof category.id === "string") {
        if (seen.has(category.id)) {
          this.violation("manifest.json", `${jsonPath}.id`, `category '${category.id}' is declared more than once`);
        }
        seen.set(category.id, category.group);

        if (
          category.id in CATEGORY_GROUP &&
          typeof category.group === "string" &&
          category.group !== CATEGORY_GROUP[category.id]
        ) {
          this.violation(
            "manifest.json",
            `${jsonPath}.group`,
            `category '${category.id}' declares group '${category.group}' but the canonical group is '${CATEGORY_GROUP[category.id]}'`
          );
        }

        // Referential integrity within the manifest itself: a category's
        // "group" must name a group manifest.json's own "groups" array
        // declares, independent of whether it also matches the canonical
        // mapping above — a manifest that renamed or dropped a group
        // entry but left categories pointing at the old name is broken
        // even if CATEGORY_GROUP would have accepted the old name too.
        if (
          declaredGroupIds &&
          typeof category.group === "string" &&
          !declaredGroupIds.has(category.group)
        ) {
          this.violation(
            "manifest.json",
            `${jsonPath}.group`,
            `category '${category.id}' references group '${category.group}' which is not declared in manifest.groups`
          );
        }
      }
    });

    for (const id of Object.keys(CATEGORY_GROUP)) {
      if (!seen.has(id)) {
        this.violation("manifest.json", "$.categories", `manifest is missing required category '${id}'`);
      }
    }
    for (const id of seen.keys()) {
      if (!(id in CATEGORY_GROUP)) {
        this.violation("manifest.json", "$.categories", `manifest declares undeclared category '${id}'`);
      }
    }

    return seen;
  }

  // Validates manifest.json's "counts" against the row data validatePoints()
  // already read — a manifest is a claim about the file next to it, and a
  // stale or hand-edited count is exactly the kind of drift the whole point
  // of publishing a manifest (instead of making a consumer count rows
  // itself) is supposed to prevent.
  validateManifestCounts(counts) {
    if (counts === undefined) return;
    if (typeof counts !== "object" || counts === null || Array.isArray(counts)) {
      this.violation("manifest.json", "$.counts", "counts must be an object");
      return;
    }

    const required = ["points", "by_category"];
    for (const field of required) {
      if (!(field in counts)) {
        this.violation("manifest.json", "$.counts", `Missing required field '${field}'`);
      }
    }
    for (const key of Object.keys(counts)) {
      if (!required.includes(key)) {
        this.violation(
          "manifest.json",
          `$.counts.${key}`,
          `Unexpected property '${key}' (additionalProperties: false)`
        );
      }
    }

    const actualByCategory = {};
    if (this.points) {
      for (const cat of Object.keys(CATEGORY_GROUP)) actualByCategory[cat] = 0;
      for (const point of this.points) {
        if (point && typeof point === "object" && typeof point.cat === "string" && point.cat in actualByCategory) {
          actualByCategory[point.cat] += 1;
        }
      }
    }

    if (counts.points !== undefined) {
      if (typeof counts.points !== "number" || !Number.isInteger(counts.points) || counts.points < 0) {
        this.violation("manifest.json", "$.counts.points", "points must be a non-negative integer");
      } else if (this.points && counts.points !== this.points.length) {
        this.violation(
          "manifest.json",
          "$.counts.points",
          `counts.points is ${counts.points} but points.json contains ${this.points.length} row(s)`
        );
      }
    }

    if (counts.by_category !== undefined) {
      if (typeof counts.by_category !== "object" || counts.by_category === null || Array.isArray(counts.by_category)) {
        this.violation("manifest.json", "$.counts.by_category", "by_category must be an object");
        return;
      }

      for (const cat of Object.keys(counts.by_category)) {
        const jsonPath = `$.counts.by_category.${cat}`;
        const value = counts.by_category[cat];

        if (!(cat in CATEGORY_GROUP)) {
          this.violation(
            "manifest.json",
            jsonPath,
            `counts.by_category has an entry for undeclared category '${cat}'`
          );
          continue;
        }
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
          this.violation("manifest.json", jsonPath, `by_category.${cat} must be a non-negative integer`);
          continue;
        }
        if (this.points && value !== actualByCategory[cat]) {
          this.violation(
            "manifest.json",
            jsonPath,
            `counts.by_category.${cat} is ${value} but points.json contains ${actualByCategory[cat]} row(s) with cat '${cat}'`
          );
        }
      }

      for (const cat of Object.keys(CATEGORY_GROUP)) {
        if (!(cat in counts.by_category)) {
          this.violation(
            "manifest.json",
            "$.counts.by_category",
            `manifest is missing counts.by_category entry for '${cat}'`
          );
        }
      }
    }
  }
}

// Helper functions
function isValidDate(str) {
  if (typeof str !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  // Check if it's an actual valid date (basic check)
  const d = new Date(str + "T00:00:00Z");
  return d instanceof Date && !isNaN(d.getTime());
}

// Main
const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error("Usage: node validate-snapshot.mjs <directory>");
  process.exit(1);
}

const dir = args[0];
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`Error: Directory not found: ${dir}`);
  process.exit(1);
}

const validator = new Validator(dir);
const result = validator.validate();

if (result.violations.length > 0) {
  console.error(`Validation failed with ${result.violations.length} violation(s):\n`);
  for (const v of result.violations) {
    console.error(`  ${v.file} @ ${v.jsonPath}`);
    console.error(`    ${v.message}`);
  }
  process.exit(1);
}

console.log("✓ Snapshot validation passed");
process.exit(0);
