import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Contract tests for the snapshot validator. Each poisoned fixture fails on a
 * real mistake someone could make during snapshot export or manual editing:
 * a leaked timestamp or sighting-tally field, a v2 row-shape field leaking
 * back in (kind/type/category/label/count/map_x/map_y/world_x/y/z-suffixed fields), a bad
 * category value, a coordinate that was never quantised, an n of 1 that
 * should have been omitted, a point on the wrong side of the map/dungeon
 * gate, a duplicate or malformed id, a timestamp hiding in ordinary free
 * text, provenance fields the model never publishes, unknown extra columns,
 * and a manifest whose taxonomy or counts drifted from the data next to it.
 *
 * The validator runs in the public repo so it cannot be coerced to accept
 * what it should not.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const validatorPath = path.join(repoRoot, "bin", "validate-snapshot.mjs");
const nodeExe = process.execPath;

function runValidator(dir) {
  const result = spawnSync(nodeExe, [validatorPath, dir], {
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

function runFixture(fixtureDir) {
  return runValidator(path.join(__dirname, "fixtures", fixtureDir));
}

test("clean snapshot passes validation", () => {
  const result = runFixture("clean-snapshot");
  assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. Stderr: ${result.stderr}`);
  assert.match(result.stdout, /✓ Snapshot validation passed/, "Should output success message");
});

test("the real shipped snapshot validates", () => {
  // This is the test that actually protects a release: it runs the
  // validator against the same public/map/sarducaa/data/static directory
  // the site serves, not a synthetic fixture.
  const result = runValidator(path.join(repoRoot, "public", "map", "sarducaa", "data", "static"));
  assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. Stderr: ${result.stderr}`);
  assert.match(result.stdout, /✓ Snapshot validation passed/, "Should output success message");
});

test("snapshot with class names containing T# pattern passes (regression)", () => {
  // The old regex /T\d/ would reject BP_Camp_T2_C, T_Rock_LOD1_D, Waypoint T3.
  // This regression test ensures the fixed regex only matches YYYY-MM-DD[T ]digits,
  // not T followed by digit in arbitrary text. This fixture MUST PASS.
  const result = runFixture("class-name-with-t-digit");
  assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. Stderr: ${result.stderr}`);
  assert.match(result.stdout, /✓ Snapshot validation passed/, "Should output success message");
});

test("snapshot with legitimate folded names passes", () => {
  // Human names folded down from class names (Iron Ore, Red Priest, Wolf
  // Den) must not trip the class-name-leak heuristic — it only flags
  // underscore-joined identifier tokens, not ordinary space-separated names.
  const result = runFixture("folded-class-labels");
  assert.strictEqual(result.exitCode, 0, `Expected exit 0, got ${result.exitCode}. Stderr: ${result.stderr}`);
  assert.match(result.stdout, /✓ Snapshot validation passed/, "Should output success message");
});

test("snapshot with owner field fails", () => {
  const result = runFixture("poisoned-owner");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'owner'/i, "Should report owner field");
});

test("snapshot with first_seen_at field fails", () => {
  const result = runFixture("poisoned-first_seen_at");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'first_seen_at'/i, "Should report first_seen_at field");
});

test("snapshot with leaked last_seen_date fails", () => {
  const result = runFixture("poisoned-last-seen-date");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'last_seen_date'/i, "Should report last_seen_date field");
});

test("snapshot with leaked observations fails", () => {
  const result = runFixture("poisoned-observations");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'observations'/i, "Should report observations field");
});

test("snapshot with source field on a point fails", () => {
  const result = runFixture("poisoned-source-on-point");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'source'/i, "source is forbidden everywhere, including points");
});

test("snapshot with a cls field fails", () => {
  // cls carried the engine class name; the exporter folds it into name at
  // export time and never publishes it at all.
  const result = runFixture("poisoned-cls-field");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'cls'/i, "cls is forbidden in the published contract");
});

test("snapshot with a class_name field fails", () => {
  const result = runFixture("poisoned-class-name-field");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'class_name'/i, "class_name is a forbidden alias for cls");
});

test("snapshot with a className field fails", () => {
  const result = runFixture("poisoned-classname-field");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'className'/i, "className is a forbidden alias for cls");
});

test("snapshot with a raw engine class name leaked into name fails", () => {
  // Published names are human names folded down from class names by the
  // exporter. A raw class token (BP_..._C, HerbNode_FicosLeaves,
  // MiningNode_Granum) leaking through unfolded must still be rejected.
  const result = runFixture("poisoned-class-name-in-name");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /looks like a raw engine class name/i, "Should report the leaked class token");
});

test("snapshot with a sub-day timestamp hidden in a name fails", () => {
  const result = runFixture("poisoned-timestamp-in-name");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /sub-day timestamp precision/i, "Should report timestamp precision violation");
});

test("snapshot with ISO timestamp fails", () => {
  const result = runFixture("poisoned-timestamp");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /sub-day timestamp precision/i, "Should report timestamp precision violation");
});

test("snapshot with nested forbidden field fails", () => {
  const result = runFixture("poisoned-nested");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'user'/i, "Should report nested user field");
});

test("snapshot with extra property fails", () => {
  const result = runFixture("poisoned-extra-property");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Unexpected property 'extra_field'/i, "Should report extra property");
});

test("snapshot with a point row missing name fails", () => {
  const result = runFixture("poisoned-missing-name");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Missing required field 'name'/i, "Should report missing name field");
});

test("snapshot with an empty-string name fails", () => {
  const result = runFixture("poisoned-empty-name");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /name must be a non-empty string/i, "Should report the empty name");
});

test("snapshot with a malformed point id fails", () => {
  const result = runFixture("poisoned-bad-id-format");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /id must be 8 lowercase hex characters/i, "Should report the bad id format");
});

test("snapshot with a duplicate id fails", () => {
  // v2 never checked uniqueness across its two files or its two id
  // schemes; v3 has one id scheme and one file, so a collision is always
  // a bug the validator must catch.
  const result = runFixture("poisoned-duplicate-id");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /duplicate id 'abcd1234'/i, "Should report the duplicate id");
});

test("snapshot with a float coordinate fails", () => {
  const result = runFixture("poisoned-float-coordinate");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /x must be an integer/i, "Should report the non-integer coordinate");
});

test("snapshot with n: 1 fails", () => {
  // n is omitted entirely when the count is 1; a present n of 1 means the
  // producer forgot to omit it.
  const result = runFixture("poisoned-n-one");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /n must be ≥2/, "Should report the redundant n");
});

test("snapshot with a bad cat value fails", () => {
  // "station" (player-housing workbenches) is dropped entirely at export
  // and is not a legal cat value — a hand-edited or stale row must be
  // rejected the same as any other value outside the closed vocabulary.
  const result = runFixture("poisoned-bad-cat");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /cat must be one of the declared category vocabulary/i, "Should report the bad cat value");
});

test("snapshot with a forbidden z field fails", () => {
  // z is load-bearing inside the private producer (it separates the Haven
  // tutorial island from Sarducaa) but was never part of the published
  // contract — the only consumer that read it threw it away.
  const result = runFixture("poisoned-forbidden-z");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'z'/i, "Should report the forbidden z field");
});

test("snapshot with a forbidden kind field fails", () => {
  const result = runFixture("poisoned-forbidden-kind");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'kind'/i, "Should report the forbidden kind field");
});

test("snapshot with a forbidden map_x field fails", () => {
  // v2 published canvas pixels and world metres on every pin; measured
  // over 397 pins the two never disagreed by more than 0.064px, so v3
  // drops the pixel duplicate and derives it downstream instead.
  const result = runFixture("poisoned-forbidden-map-x");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Forbidden field 'map_x'/i, "Should report the forbidden map_x field");
});

test("snapshot with an interior-group point missing map fails", () => {
  // exit/boss/journal/lever/loot sit inside a dungeon level, not on the
  // surface plate — without map the render layer has no way to know
  // which level to draw the point on.
  const result = runFixture("poisoned-interior-missing-map");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /Missing required field 'map'/i, "Should report the missing map field");
});

test("snapshot with a surface-category point carrying map fails", () => {
  const result = runFixture("poisoned-surface-with-map");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /'map' is only valid on interior-group categories/i, "Should report the misplaced map field");
});

test("snapshot with manifest schema_version: v2 fails", () => {
  const result = runFixture("poisoned-manifest-schema-v2");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /schema_version must be exactly 'v3'/i, "Should report the stale schema_version");
});

test("snapshot with a manifest counts.points mismatch fails", () => {
  // A manifest is a claim about the file next to it — the whole point of
  // publishing counts (instead of making a consumer count rows itself) is
  // defeated if the count can silently drift from the data.
  const result = runFixture("poisoned-manifest-count-mismatch");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /counts\.points is 1 but points\.json contains 2 row\(s\)/i, "Should report the count mismatch");
});

test("snapshot with an undeclared category in the manifest fails", () => {
  // v2's consumer derived its taxonomy by slugifying row labels, which is
  // how it ended up with 42 categories for 24 concepts; v3's manifest is
  // the published source of truth and must not grow a category the
  // validator's closed vocabulary doesn't recognise.
  const result = runFixture("poisoned-manifest-undeclared-category");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(result.stderr, /manifest declares undeclared category 'extraction'/i, "Should report the undeclared category");
});

test("snapshot with a category referencing an undeclared group fails", () => {
  // The manifest's own "groups" array is the source of truth a consumer's
  // filter UI reads; a category pointing at a group name the manifest
  // never declares would render with no home.
  const result = runFixture("poisoned-manifest-bad-group");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  assert.match(
    result.stderr,
    /category 'priest' references group 'faith' which is not declared in manifest\.groups/i,
    "Should report the undeclared group reference"
  );
});

test("validator reports all violations, not just the first", () => {
  // The poisoned-multi-violation fixture has several independent violations:
  // bad id format, bad cat value, non-integer coordinate, and a forbidden
  // owner field (which also trips additionalProperties, since owner is not
  // a published point field). This tests that the validator reports all of
  // them in one run.
  const result = runFixture("poisoned-multi-violation");
  assert.notStrictEqual(result.exitCode, 0, "Should fail");
  const stderr = result.stderr;
  assert.match(stderr, /Validation failed with 5 violation/, "Should report multiple violations in header");
  assert.match(stderr, /id must be 8 lowercase hex characters/, "Should report id format violation");
  assert.match(stderr, /cat must be one of the declared category vocabulary/, "Should report bad cat violation");
  assert.match(stderr, /x must be an integer/, "Should report coordinate violation");
  assert.match(stderr, /Forbidden field 'owner'/, "Should report forbidden field violation");
  assert.match(stderr, /Unexpected property 'owner'/, "Should report the additionalProperties violation owner also trips");
});
