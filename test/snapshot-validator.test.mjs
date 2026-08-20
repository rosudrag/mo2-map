import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Contract tests for the snapshot validator. Each poisoned fixture fails on a
 * real mistake someone could make during snapshot export or manual editing:
 * a leaked timestamp or sighting-tally field, a dropped-kind row that leaks
 * back in, a coordinate that was never quantised, a zero-node row, a
 * malformed id, a timestamp hiding in ordinary free text, provenance fields
 * the v1 model allowed and v2 does not, unknown extra columns, enum values
 * outside the contract, etc.
 *
 * The validator runs in the public repo so it cannot be coerced to accept
 * what it should not.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const validatorPath = path.join(repoRoot, "bin", "validate-snapshot.mjs");
const nodeExe = process.execPath;

function runValidator(fixtureDir) {
  const fullPath = path.join(__dirname, "fixtures", fixtureDir);
  const result = spawnSync(nodeExe, [validatorPath, fullPath], {
    encoding: "utf8",
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"]
  });
  return {
    exitCode: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

test("clean snapshot passes validation", () => {
  const result = runValidator("clean-snapshot");
  assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. Stderr: ${result.stderr}`);
  assert.match(result.stdout, /✓ Snapshot validation passed/, "Should output success message");
});

test("snapshot with class names containing T# pattern passes (regression)", () => {
  // The old regex /T\d/ would reject BP_Camp_T2_C, T_Rock_LOD1_D, Waypoint T3.
  // This regression test ensures the fixed regex only matches YYYY-MM-DD[T ]digits,
  // not T followed by digit in arbitrary text. This fixture MUST PASS.
  const result = runValidator("class-name-with-t-digit");
  assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. Stderr: ${result.stderr}`);
  assert.match(result.stdout, /✓ Snapshot validation passed/, "Should output success message");
});

test("snapshot with owner field fails", () => {
  const result = runValidator("poisoned-owner");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'owner'/i, "Should report owner field");
});

test("snapshot with first_seen_at field fails", () => {
  const result = runValidator("poisoned-first_seen_at");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'first_seen_at'/i, "Should report first_seen_at field");
});

test("snapshot with leaked last_seen_date fails", () => {
  const result = runValidator("poisoned-last-seen-date");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'last_seen_date'/i, "Should report last_seen_date field");
});

test("snapshot with leaked observations fails", () => {
  const result = runValidator("poisoned-observations");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'observations'/i, "Should report observations field");
});

test("snapshot with source field on a pin fails (v1 allowance retired in v2)", () => {
  const result = runValidator("poisoned-source-on-pin");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'source'/i, "source is now forbidden everywhere, including pins");
});

test("snapshot with a station discovery row fails", () => {
  // station (player-housing workbenches) is dropped entirely at export and is
  // not a valid published kind — a hand-edited or stale row must be rejected.
  const result = runValidator("poisoned-station-row");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /kind must be one of/i, "Should report the bad kind enum value");
});

test("snapshot with a float discovery coordinate fails", () => {
  const result = runValidator("poisoned-float-coordinate");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /x must be an integer/i, "Should report the non-integer coordinate");
});

test("snapshot with count: 0 fails", () => {
  const result = runValidator("poisoned-count-zero");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /count must be ≥1/, "Should report the zero count");
});

test("snapshot with a malformed discovery id fails", () => {
  const result = runValidator("poisoned-bad-id-format");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /id must be 8 lowercase hex characters/i, "Should report the bad id format");
});

test("snapshot with a sub-day timestamp hidden in a label fails", () => {
  const result = runValidator("poisoned-timestamp-in-label");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /sub-day timestamp precision/i, "Should report timestamp precision violation");
});

test("snapshot with ISO timestamp fails", () => {
  const result = runValidator("poisoned-timestamp");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /sub-day timestamp precision/i, "Should report timestamp precision violation");
});

test("snapshot with nested forbidden field fails", () => {
  const result = runValidator("poisoned-nested");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'user'/i, "Should report nested user field");
});

test("snapshot with extra property fails", () => {
  const result = runValidator("poisoned-extra-property");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Unexpected property 'extra_field'|additionalProperties: false/i, "Should report extra property");
});

test("snapshot with bad enum value fails", () => {
  const result = runValidator("poisoned-bad-enum");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /kind must be one of|invalid_kind/i, "Should report bad enum value");
});

test("snapshot with a discovery row missing label fails", () => {
  const result = runValidator("poisoned-missing-label");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Missing required field 'label'/i, "Should report missing label field");
});

test("snapshot with an empty-string label fails", () => {
  const result = runValidator("poisoned-empty-label");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /label must be a non-empty string/i, "Should report the empty label");
});

test("snapshot with a cls field fails", () => {
  // cls carried the engine class name; the v2 contract folds it into label
  // at export time and no longer publishes it at all.
  const result = runValidator("poisoned-cls-field");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'cls'/i, "cls is forbidden in the v2 published contract");
});

test("snapshot with a class_name field fails", () => {
  const result = runValidator("poisoned-class-name-field");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'class_name'/i, "class_name is a forbidden alias for cls");
});

test("snapshot with a className field fails", () => {
  const result = runValidator("poisoned-classname-field");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'className'/i, "className is a forbidden alias for cls");
});

test("snapshot with a raw engine class name leaked into label fails", () => {
  // Published labels are human names folded down from class names by the
  // exporter. A raw class token (BP_..._C, HerbNode_FicosLeaves,
  // MiningNode_Granum) leaking through unfolded must still be rejected.
  const result = runValidator("poisoned-class-name-in-label");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /looks like a raw engine class name/i, "Should report the leaked class token");
});

test("snapshot with legitimate folded labels passes", () => {
  // Human names folded down from class names (Iron Ore, Red Priest, Chest A,
  // Wolf Den) must not trip the class-name-leak heuristic — it only flags
  // underscore-joined identifier tokens, not ordinary space-separated names.
  const result = runValidator("folded-class-labels");
  assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. Stderr: ${result.stderr}`);
  assert.match(result.stdout, /✓ Snapshot validation passed/, "Should output success message");
});

test("validator reports all violations, not just the first", () => {
  // The poisoned-multi-violation fixture has several independent violations:
  // bad id format, bad enum value, non-integer coordinate, non-positive
  // count, and a forbidden owner field (which also trips additionalProperties,
  // since owner is not a published discovery field). This tests that the
  // validator reports all of them in one run.
  const result = runValidator("poisoned-multi-violation");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  const stderr = result.stderr;
  assert.match(stderr, /Validation failed with 6 violation/, "Should report multiple violations in header");
  assert.match(stderr, /id must be 8 lowercase hex characters/, "Should report id format violation");
  assert.match(stderr, /kind must be one of/, "Should report enum violation");
  assert.match(stderr, /x must be an integer/, "Should report coordinate violation");
  assert.match(stderr, /count must be ≥1/, "Should report count violation");
  assert.match(stderr, /Forbidden field 'owner'/, "Should report forbidden field violation");
});
