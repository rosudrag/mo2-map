#!/usr/bin/env node

import fs from "fs";
import path from "path";

/*
 * Snapshot validator: structure, forbidden fields, and timestamp precision.
 *
 * The validator runs in the public repo so it cannot be coerced to accept what
 * it should not. It enforces the snapshot contract: files must match the schema,
 * must not contain personally-identifying or leakage-indicating fields, and must
 * quantise dates to day granularity (no sub-day timestamps that reconstruct
 * individual activity sessions and movement history).
 *
 * Exit 0 on pass, non-zero on failure. Reports every violation, not just the
 * first — people fix batch bugs faster than one round-trip per violation.
 */

const FORBIDDEN_FIELDS = new Set([
  "owner",
  "seq",
  "cell_x",
  "cell_y",
  "status",
  "note",
  "meta_json",
  "first_seen_at",
  "last_seen_at",
  "api_key",
  "user",
  "account",
  "ip"
]);

const ALLOWED_UPDATED_BY = new Set(["seed", "gamefiles", "community"]);

// Timestamp precision check: match YYYY-MM-DD followed by T or space and time digits.
// This detects sub-day precision (ISO 8601 timestamps) while avoiding false positives on
// legitimate data like class names (BP_Camp_T2_C) and label text (12:30, Waypoint T3).
// Matches: 2026-08-19T14:23:11Z, 2026-08-19 14:23, 2026-08-19T14:23:11.123Z
// Does NOT match: 2026-08-19, BP_Camp_T2_C, 14:23:11, "12:30 meeting"
const TIMESTAMP_PRECISION_REGEX = /\d{4}-\d{2}-\d{2}[T ]\d/;
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
    this.validateCoverage();
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
  // updated_by is file-scoped: never allowed on discoveries (anonymous machine observations);
  // only allowed on pins (where human curation and provenance are meaningful).
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

          // Check if this is updated_by: only allowed on pins with specific values
          if (key === "updated_by") {
            if (filename !== "pins.json") {
              // Discoveries and other files cannot have updated_by
              this.violation(
                filename,
                currentPath,
                `Field 'updated_by' is not allowed in ${filename} (only allowed on pins)`
              );
            } else if (!ALLOWED_UPDATED_BY.has(value)) {
              // Pins can have updated_by but only with specific values
              this.violation(
                filename,
                currentPath,
                `Field 'updated_by' has forbidden value '${value}' (allowed: seed, gamefiles, community)`
              );
            }
          } else if (FORBIDDEN_FIELDS.has(key)) {
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
    const required = [
      "id", "kind", "class_name", "label",
      "world_x", "world_y", "world_z",
      "seen_count", "observations",
      "first_seen_date", "last_seen_date", "source"
    ];
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

    // Type checks
    if (item.id && typeof item.id !== "string") {
      this.violation(filename, `${jsonPath}.id`, "id must be a string");
    }
    if (item.id && !isUUID(item.id)) {
      this.violation(filename, `${jsonPath}.id`, "id must be a valid UUID");
    }

    if (item.kind && !["spawn", "resource", "container", "npc", "structure"].includes(item.kind)) {
      this.violation(
        filename,
        `${jsonPath}.kind`,
        `kind must be one of: spawn, resource, container, npc, structure`
      );
    }

    if (item.class_name && typeof item.class_name !== "string") {
      this.violation(filename, `${jsonPath}.class_name`, "class_name must be a string");
    }
    if (item.class_name && item.class_name.length > 160) {
      this.violation(filename, `${jsonPath}.class_name`, "class_name must be ≤160 characters");
    }

    if (item.label && typeof item.label !== "string") {
      this.violation(filename, `${jsonPath}.label`, "label must be a string");
    }
    if (item.label && item.label.length > 128) {
      this.violation(filename, `${jsonPath}.label`, "label must be ≤128 characters");
    }

    // Coordinates
    if (item.world_x !== undefined && typeof item.world_x !== "number") {
      this.violation(filename, `${jsonPath}.world_x`, "world_x must be a number");
    }
    if (item.world_y !== undefined && typeof item.world_y !== "number") {
      this.violation(filename, `${jsonPath}.world_y`, "world_y must be a number");
    }
    if (item.world_z !== undefined && typeof item.world_z !== "number") {
      this.violation(filename, `${jsonPath}.world_z`, "world_z must be a number");
    }

    // Counts
    if (item.seen_count !== undefined) {
      if (typeof item.seen_count !== "number" || !Number.isInteger(item.seen_count)) {
        this.violation(filename, `${jsonPath}.seen_count`, "seen_count must be an integer");
      }
      if (item.seen_count < 1) {
        this.violation(filename, `${jsonPath}.seen_count`, "seen_count must be ≥1");
      }
    }

    if (item.observations !== undefined) {
      if (typeof item.observations !== "number" || !Number.isInteger(item.observations)) {
        this.violation(filename, `${jsonPath}.observations`, "observations must be an integer");
      }
      if (item.observations < 1) {
        this.violation(filename, `${jsonPath}.observations`, "observations must be ≥1");
      }
    }

    // Dates (YYYY-MM-DD format)
    if (item.first_seen_date && !isValidDate(item.first_seen_date)) {
      this.violation(filename, `${jsonPath}.first_seen_date`, "first_seen_date must be YYYY-MM-DD format");
    }
    if (item.last_seen_date && !isValidDate(item.last_seen_date)) {
      this.violation(filename, `${jsonPath}.last_seen_date`, "last_seen_date must be YYYY-MM-DD format");
    }

    if (item.source && !["survey", "gamefile", "community"].includes(item.source)) {
      this.violation(
        filename,
        `${jsonPath}.source`,
        `source must be one of: survey, gamefile, community`
      );
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

    const required = ["id", "label", "type", "category", "map_x", "map_y", "source"];
    const optional = ["world_x", "world_y", "world_z", "meta", "updated_by"];
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
    if (item.id && !isUUID(item.id)) {
      this.violation(filename, `${jsonPath}.id`, "id must be a valid UUID");
    }

    if (item.label && typeof item.label !== "string") {
      this.violation(filename, `${jsonPath}.label`, "label must be a string");
    }
    if (item.label && item.label.length > 128) {
      this.violation(filename, `${jsonPath}.label`, "label must be ≤128 characters");
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

    if (item.source && !["survey", "gamefile", "community"].includes(item.source)) {
      this.violation(
        filename,
        `${jsonPath}.source`,
        `source must be one of: survey, gamefile, community`
      );
    }

    // Validate meta if present
    if (item.meta !== undefined) {
      if (typeof item.meta !== "object" || item.meta === null || Array.isArray(item.meta)) {
        this.violation(filename, `${jsonPath}.meta`, "meta must be an object");
      } else {
        const metaAllowed = new Set([
          "position_source", "poi_id", "poi_class", "package", "anchor", "instances", "spread_m"
        ]);
        for (const key of Object.keys(item.meta)) {
          if (!metaAllowed.has(key)) {
            this.violation(
              filename,
              `${jsonPath}.meta.${key}`,
              `Unexpected property '${key}' in meta (additionalProperties: false)`
            );
          }
        }
      }
    }
  }

  validateCoverage() {
    const data = this.readJsonFile("coverage.json");
    if (!data) return;

    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      this.violation("coverage.json", "$", "Root must be an object");
      return;
    }

    // Check required fields
    if (!("cell_size_m" in data)) {
      this.violation("coverage.json", "$", "Missing required field 'cell_size_m'");
    }
    if (!("cells" in data)) {
      this.violation("coverage.json", "$", "Missing required field 'cells'");
    }

    // Check additionalProperties
    const allowed = new Set(["cell_size_m", "cells"]);
    for (const key of Object.keys(data)) {
      if (!allowed.has(key)) {
        this.violation(
          "coverage.json",
          `$.${key}`,
          `Unexpected property '${key}' (additionalProperties: false)`
        );
      }
    }

    if (data.cell_size_m !== undefined) {
      if (typeof data.cell_size_m !== "number" || !Number.isInteger(data.cell_size_m)) {
        this.violation("coverage.json", "$.cell_size_m", "cell_size_m must be an integer");
      }
    }

    if (data.cells !== undefined) {
      if (!Array.isArray(data.cells)) {
        this.violation("coverage.json", "$.cells", "cells must be an array");
      } else {
        data.cells.forEach((cell, idx) => {
          const path = `$.cells[${idx}]`;
          if (typeof cell !== "object" || cell === null) {
            this.violation("coverage.json", path, "Cell must be an object");
            return;
          }

          // Check required fields
          if (!("x" in cell)) {
            this.violation("coverage.json", path, "Missing required field 'x'");
          }
          if (!("y" in cell)) {
            this.violation("coverage.json", path, "Missing required field 'y'");
          }
          if (!("rows" in cell)) {
            this.violation("coverage.json", path, "Missing required field 'rows'");
          }

          // Check additionalProperties
          const cellAllowed = new Set(["x", "y", "rows"]);
          for (const key of Object.keys(cell)) {
            if (!cellAllowed.has(key)) {
              this.violation(
                "coverage.json",
                `${path}.${key}`,
                `Unexpected property '${key}' (additionalProperties: false)`
              );
            }
          }

          // Type checks
          if (cell.x !== undefined && (typeof cell.x !== "number" || !Number.isInteger(cell.x))) {
            this.violation("coverage.json", `${path}.x`, "x must be an integer");
          }
          if (cell.y !== undefined && (typeof cell.y !== "number" || !Number.isInteger(cell.y))) {
            this.violation("coverage.json", `${path}.y`, "y must be an integer");
          }
          if (cell.rows !== undefined && (typeof cell.rows !== "number" || !Number.isInteger(cell.rows))) {
            this.violation("coverage.json", `${path}.rows`, "rows must be an integer");
          }
        });
      }
    }

    this.checkForbiddenFields(data, "coverage.json");
    this.checkTimestampPrecision(data, "coverage.json");
  }

  validateManifest() {
    const data = this.readJsonFile("manifest.json");
    if (!data) return;

    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      this.violation("manifest.json", "$", "Root must be an object");
      return;
    }

    const required = ["schema_version", "snapshot_date", "counts", "gates_applied", "coverage"];
    const optional = ["diff_vs_previous"];
    const allowed = new Set([...required, ...optional]);

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

    if (data.snapshot_date && !isValidDate(data.snapshot_date)) {
      this.violation("manifest.json", "$.snapshot_date", "snapshot_date must be YYYY-MM-DD format");
    }

    if (data.gates_applied !== undefined) {
      if (!Array.isArray(data.gates_applied)) {
        this.violation("manifest.json", "$.gates_applied", "gates_applied must be an array");
      } else {
        data.gates_applied.forEach((item, idx) => {
          if (typeof item !== "string") {
            this.violation("manifest.json", `$.gates_applied[${idx}]`, "gates_applied items must be strings");
          }
        });
      }
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
      }
    }

    // Validate coverage
    if (data.coverage !== undefined) {
      if (typeof data.coverage !== "object" || data.coverage === null || Array.isArray(data.coverage)) {
        this.violation("manifest.json", "$.coverage", "coverage must be an object");
      } else {
        if (!("surveyed_cells" in data.coverage)) {
          this.violation("manifest.json", "$.coverage", "Missing required field 'surveyed_cells'");
        }
        if (!("bbox_cells" in data.coverage)) {
          this.violation("manifest.json", "$.coverage", "Missing required field 'bbox_cells'");
        }
        if (!("percent" in data.coverage)) {
          this.violation("manifest.json", "$.coverage", "Missing required field 'percent'");
        }

        const covAllowed = new Set(["surveyed_cells", "bbox_cells", "percent"]);
        for (const key of Object.keys(data.coverage)) {
          if (!covAllowed.has(key)) {
            this.violation(
              "manifest.json",
              `$.coverage.${key}`,
              `Unexpected property '${key}' in coverage (additionalProperties: false)`
            );
          }
        }
      }
    }

    // Validate optional diff_vs_previous
    if (data.diff_vs_previous !== undefined) {
      if (typeof data.diff_vs_previous !== "object" || data.diff_vs_previous === null || Array.isArray(data.diff_vs_previous)) {
        this.violation("manifest.json", "$.diff_vs_previous", "diff_vs_previous must be an object");
      } else {
        const diffAllowed = new Set(["added", "removed"]);
        for (const key of Object.keys(data.diff_vs_previous)) {
          if (!diffAllowed.has(key)) {
            this.violation(
              "manifest.json",
              `$.diff_vs_previous.${key}`,
              `Unexpected property '${key}' in diff_vs_previous (additionalProperties: false)`
            );
          }
        }
      }
    }

    this.checkForbiddenFields(data, "manifest.json");
    this.checkTimestampPrecision(data, "manifest.json");
  }
}

// Helper functions
function isUUID(str) {
  if (typeof str !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

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
