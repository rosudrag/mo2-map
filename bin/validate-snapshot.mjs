#!/usr/bin/env node

import fs from "fs";
import path from "path";

/*
 * Snapshot validator: structure, field list, and timestamp precision.
 *
 * Enforces the v2 snapshot contract: files match the schema, contain only
 * specified fields, and carry no field that reconstructs collection
 * activity (who found what, when, how often). Exit 0 on pass, non-zero on
 * failure. Reports all violations in a single run.
 */

// Forbidden anywhere in any published file, at any nesting depth. This is
// the exact denylist from the shared snapshot contract — every field that
// would let a reader reconstruct collection activity (timestamps, sighting
// tallies, server/account identity), reintroduce human-curation provenance
// (source, updated_by), or carry an engine class identifier (cls and its
// class_name/className aliases) the v2 model no longer publishes.
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

// Timestamp precision check: day-granularity enforcement via two layers.
// Layer 1 (this regex): scan all strings for full ISO date-times (YYYY-MM-DD[T ]digits).
// Layer 2 (isValidDate): manifest.json's `generated` field must be exactly
// YYYY-MM-DD format, rejecting any time component.
// Bare times in free-text fields (e.g., label) are permitted.
const TIMESTAMP_PRECISION_REGEX = /\d{4}-\d{2}-\d{2}[T ]\d/;

const DISCOVERY_KINDS = ["resource", "spawn", "npc", "structure", "container"];
const DISCOVERY_ID_REGEX = /^[0-9a-f]{8}$/;

// A published label is a folded human name, never a raw engine class token.
// Class tokens are code identifiers: underscore-joined segments with no
// spaces (BP_Ore_Iron_C, HerbNode_FicosLeaves, T_Rock_LOD1_D). Folded human
// names always contain a space (or at most a bare hyphen, e.g. "Tier-2
// Camp") — so "made only of underscore-joined word characters" reliably
// flags a leaked class name without rejecting a legitimate folded label.
const CLASS_NAME_LEAK_REGEX = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$/;

class Validator {
  constructor(dir) {
    this.dir = dir;
    this.violations = [];
  }

  violation(file, jsonPath, message) {
    this.violations.push({ file, jsonPath, message });
  }

  validate() {
    this.validateDiscoveries();
    this.validatePins();
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
  checkForbiddenFields(data, filename, jsonPath = "$") {
    if (data === null || data === undefined) return;

    if (typeof data === "object") {
      if (Array.isArray(data)) {
        data.forEach((item, idx) => {
          this.checkForbiddenFields(item, filename, `${jsonPath}[${idx}]`);
        });
      } else {
        for (const [key, value] of Object.entries(data)) {
          const currentPath = `${jsonPath}.${key}`;

          if (FORBIDDEN_FIELDS.has(key)) {
            this.violation(
              filename,
              currentPath,
              `Forbidden field '${key}' present`
            );
          }

          // Recursively check nested structures
          this.checkForbiddenFields(value, filename, currentPath);
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

  validateDiscoveries() {
    const data = this.readJsonFile("discoveries.json");
    if (!data) return;

    if (!Array.isArray(data)) {
      this.violation("discoveries.json", "$", "Root must be an array");
      return;
    }

    data.forEach((item, idx) => {
      const path = `$[${idx}]`;
      this.validateDiscoveryItem(item, "discoveries.json", path);
    });

    this.checkForbiddenFields(data, "discoveries.json");
    this.checkTimestampPrecision(data, "discoveries.json");
  }

  validateDiscoveryItem(item, filename, jsonPath) {
    if (typeof item !== "object" || item === null) {
      this.violation(filename, jsonPath, "Item must be an object");
      return;
    }

    // Check required fields
    const required = ["id", "kind", "label", "x", "y", "z", "count"];
    for (const field of required) {
      if (!(field in item)) {
        this.violation(
          filename,
          jsonPath,
          `Missing required field '${field}'`
        );
      }
    }

    // Check additionalProperties
    const allowed = new Set(required);
    for (const key of Object.keys(item)) {
      if (!allowed.has(key)) {
        this.violation(
          filename,
          `${jsonPath}.${key}`,
          `Unexpected property '${key}' (additionalProperties: false)`
        );
      }
    }

    // Deterministic id: first 8 hex chars of sha256("kind|cls|x|y")
    if (item.id !== undefined && typeof item.id !== "string") {
      this.violation(filename, `${jsonPath}.id`, "id must be a string");
    }
    if (item.id && !DISCOVERY_ID_REGEX.test(item.id)) {
      this.violation(filename, `${jsonPath}.id`, "id must be 8 lowercase hex characters");
    }

    if (item.kind && !DISCOVERY_KINDS.includes(item.kind)) {
      this.violation(
        filename,
        `${jsonPath}.kind`,
        `kind must be one of: ${DISCOVERY_KINDS.join(", ")}`
      );
    }

    if (item.label !== undefined && (typeof item.label !== "string" || item.label.length === 0)) {
      this.violation(filename, `${jsonPath}.label`, "label must be a non-empty string");
    }
    if (item.label && item.label.length > 128) {
      this.violation(filename, `${jsonPath}.label`, "label must be ≤128 characters");
    }
    if (item.label && typeof item.label === "string" && CLASS_NAME_LEAK_REGEX.test(item.label)) {
      this.violation(
        filename,
        `${jsonPath}.label`,
        `label looks like a raw engine class name, not a folded human name: '${item.label}'`
      );
    }

    // Coordinates: integer world metres
    for (const axis of ["x", "y", "z"]) {
      if (item[axis] !== undefined && (typeof item[axis] !== "number" || !Number.isInteger(item[axis]))) {
        this.violation(filename, `${jsonPath}.${axis}`, `${axis} must be an integer`);
      }
    }

    // Count: how many nodes were merged into this row
    if (item.count !== undefined) {
      if (typeof item.count !== "number" || !Number.isInteger(item.count)) {
        this.violation(filename, `${jsonPath}.count`, "count must be an integer");
      }
      if (item.count < 1) {
        this.violation(filename, `${jsonPath}.count`, "count must be ≥1");
      }
    }
  }

  validatePins() {
    const data = this.readJsonFile("pins.json");
    if (!data) return;

    if (!Array.isArray(data)) {
      this.violation("pins.json", "$", "Root must be an array");
      return;
    }

    data.forEach((item, idx) => {
      const path = `$[${idx}]`;
      this.validatePinItem(item, "pins.json", path);
    });

    this.checkForbiddenFields(data, "pins.json");
    this.checkTimestampPrecision(data, "pins.json");
  }

  validatePinItem(item, filename, jsonPath) {
    if (typeof item !== "object" || item === null) {
      this.violation(filename, jsonPath, "Item must be an object");
      return;
    }

    const required = ["id", "label", "type", "category", "map_x", "map_y"];
    const optional = ["world_x", "world_y", "world_z"];
    const allowed = new Set([...required, ...optional]);

    // Check required fields
    for (const field of required) {
      if (!(field in item)) {
        this.violation(filename, jsonPath, `Missing required field '${field}'`);
      }
    }

    // Check additionalProperties
    for (const key of Object.keys(item)) {
      if (!allowed.has(key)) {
        this.violation(
          filename,
          `${jsonPath}.${key}`,
          `Unexpected property '${key}' (additionalProperties: false)`
        );
      }
    }

    // Type checks
    if (item.id !== undefined && (typeof item.id !== "string" || item.id.length === 0)) {
      this.violation(filename, `${jsonPath}.id`, "id must be a non-empty string");
    }

    if (item.label !== undefined && typeof item.label !== "string") {
      this.violation(filename, `${jsonPath}.label`, "label must be a string");
    }
    if (item.label && item.label.length > 128) {
      this.violation(filename, `${jsonPath}.label`, "label must be ≤128 characters");
    }

    if (item.type !== undefined && typeof item.type !== "string") {
      this.violation(filename, `${jsonPath}.type`, "type must be a string");
    }
    if (item.category !== undefined && typeof item.category !== "string") {
      this.violation(filename, `${jsonPath}.category`, "category must be a string");
    }

    if (item.map_x !== undefined && typeof item.map_x !== "number") {
      this.violation(filename, `${jsonPath}.map_x`, "map_x must be a number");
    }
    if (item.map_y !== undefined && typeof item.map_y !== "number") {
      this.violation(filename, `${jsonPath}.map_y`, "map_y must be a number");
    }

    // Optional world coordinates
    if (item.world_x !== undefined && typeof item.world_x !== "number") {
      this.violation(filename, `${jsonPath}.world_x`, "world_x must be a number");
    }
    if (item.world_y !== undefined && typeof item.world_y !== "number") {
      this.violation(filename, `${jsonPath}.world_y`, "world_y must be a number");
    }
    if (item.world_z !== undefined && typeof item.world_z !== "number") {
      this.violation(filename, `${jsonPath}.world_z`, "world_z must be a number");
    }
  }

  validateManifest() {
    const data = this.readJsonFile("manifest.json");
    if (!data) return;

    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      this.violation("manifest.json", "$", "Root must be an object");
      return;
    }

    const required = ["id", "schema_version", "generated", "counts"];
    const allowed = new Set(required);

    // Check required fields
    for (const field of required) {
      if (!(field in data)) {
        this.violation("manifest.json", "$", `Missing required field '${field}'`);
      }
    }

    // Check additionalProperties
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

    if (data.schema_version !== undefined && typeof data.schema_version !== "string") {
      this.violation("manifest.json", "$.schema_version", "schema_version must be a string");
    }

    if (data.generated !== undefined && !isValidDate(data.generated)) {
      this.violation("manifest.json", "$.generated", "generated must be YYYY-MM-DD format");
    }

    // Validate counts
    if (data.counts !== undefined) {
      if (typeof data.counts !== "object" || data.counts === null || Array.isArray(data.counts)) {
        this.violation("manifest.json", "$.counts", "counts must be an object");
      } else {
        const countsAllowed = new Set(["discoveries", "pins", "by_kind"]);
        for (const key of Object.keys(data.counts)) {
          if (!countsAllowed.has(key)) {
            this.violation(
              "manifest.json",
              `$.counts.${key}`,
              `Unexpected property '${key}' in counts (additionalProperties: false)`
            );
          }
        }

        if (data.counts.discoveries !== undefined && typeof data.counts.discoveries !== "number") {
          this.violation("manifest.json", "$.counts.discoveries", "discoveries must be a number");
        }
        if (data.counts.pins !== undefined && typeof data.counts.pins !== "number") {
          this.violation("manifest.json", "$.counts.pins", "pins must be a number");
        }

        if (data.counts.by_kind !== undefined) {
          if (typeof data.counts.by_kind !== "object" || data.counts.by_kind === null || Array.isArray(data.counts.by_kind)) {
            this.violation("manifest.json", "$.counts.by_kind", "by_kind must be an object");
          } else {
            const byKindAllowed = new Set(DISCOVERY_KINDS);
            for (const key of Object.keys(data.counts.by_kind)) {
              if (!byKindAllowed.has(key)) {
                this.violation(
                  "manifest.json",
                  `$.counts.by_kind.${key}`,
                  `Unexpected property '${key}' in by_kind (additionalProperties: false)`
                );
              }
            }
          }
        }
      }
    }

    this.checkForbiddenFields(data, "manifest.json");
    this.checkTimestampPrecision(data, "manifest.json");
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
