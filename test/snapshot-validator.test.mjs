import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Contract tests for the snapshot validator. Each test fails on a plausible
 * real mistake someone could make during snapshot export or manual editing:
 * forgetting to strip personally-identifying fields, allowing sub-day
 * timestamps that reconstruct activity patterns, unknown extra columns, enum
 * values outside the contract, etc.
 *
 * The validator runs in the public repo so it cannot be coerced to accept what
 * it should not.
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

test("snapshot with ISO timestamp fails", () => {
  const result = runValidator("poisoned-timestamp");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /sub-day timestamp precision/i, "Should report timestamp precision violation");
});

test("snapshot with class names containing T# pattern passes (regression)", () => {
  // The old regex /T\d/ would reject BP_Camp_T2_C, T_Rock_LOD1_D, Waypoint T3.
  // This regression test ensures the fixed regex only matches YYYY-MM-DD[T ]digits,
  // not T followed by digit in arbitrary text. This fixture MUST PASS.
  const result = runValidator("class-name-with-t-digit");
  assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. Stderr: ${result.stderr}`);
  assert.match(result.stdout, /✓ Snapshot validation passed/, "Should output success message");
});

test("snapshot with forbidden updated_by value fails", () => {
  const result = runValidator("poisoned-updated-by-person");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /updated_by.*forbidden value/i, "Should report forbidden updated_by value");
});

test("snapshot with nested forbidden field fails", () => {
  const result = runValidator("poisoned-nested");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'user'/i, "Should report nested user field");
});

test("snapshot with allowed updated_by value on pin passes", () => {
  const result = runValidator("allowed-updated-by-on-pin");
  assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. Stderr: ${result.stderr}`);
  assert.match(result.stdout, /✓ Snapshot validation passed/, "Should output success message");
});

test("snapshot with updated_by on discovery fails", () => {
  const result = runValidator("poisoned-updated-by-on-discovery");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /updated_by.*not allowed in discoveries/i, "Should report updated_by not allowed on discoveries");
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

test("validator reports all violations, not just the first", () => {
  // The poisoned-multi-violation fixture has several independent violations:
  // invalid UUID, bad enum value, negative count, and forbidden owner field.
  // This tests that the validator reports all of them in one run.
  const result = runValidator("poisoned-multi-violation");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  // The error output should contain multiple violation details
  const stderr = result.stderr;
  assert.match(stderr, /Validation failed with 5 violation/, "Should report multiple violations in header");
  assert.match(stderr, /id must be a valid UUID/, "Should report UUID violation");
  assert.match(stderr, /kind must be one of/, "Should report enum violation");
  assert.match(stderr, /seen_count must be ≥1/, "Should report count violation");
  assert.match(stderr, /Forbidden field 'owner'/, "Should report forbidden field violation");
});
