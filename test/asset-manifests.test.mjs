import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAPS } from "../public/map/registry.js";

/*
 * Contract tests for the published plate and tile-pyramid asset manifests
 * (townplates, surfaceplates, dungeonplates and their -art siblings, plus the
 * two tile pyramids). These assets are content-hashed and republished by a
 * separate offline pipeline that rewrites both the image files and the JSON
 * manifest naming them - two writes that are not atomic. A republish that
 * updates the image but not the manifest, or the manifest but not the image,
 * produces nothing louder than a 404 in the browser console and a blank plate
 * on the map; nothing in `bin/validate-snapshot.mjs` or the build sees these
 * files at all, since they are not the discovery/pin snapshot.
 *
 * Every assertion here is derived from what the layer code actually
 * dereferences (map/plate-overlay.js, map/townplates.js, map/surfaceplates.js,
 * map/dungeonmode.js, map/artwork-layer.js, map/artwork-raster.js) or from an
 * invariant a manifest's own `note` field documents, not from whatever the
 * manifest happens to contain today - see each test for the specific line(s)
 * that make the field or the invariant real.
 *
 * Manifest URLs are page-relative (the layer code fetches and uses them
 * exactly as written, e.g. `L.imageOverlay(plate.file, ...)`, which Leaflet
 * resolves against the current document - the continent's own index.html),
 * not repo-root-relative and not relative to the manifest's own directory.
 * Every path in this file is resolved the same way: joined onto
 * public/map/sarducaa/, never onto the repo root or a manifest's own folder.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const mapSrcDir = path.join(repoRoot, "public", "map", "app", "src", "map");
const sarducaaDir = path.join(repoRoot, "public", "map", "sarducaa");

function readManifestUrls(sourceFile) {
  const src = readFileSync(path.join(mapSrcDir, sourceFile), "utf8");
  const urls = {};
  for (const m of src.matchAll(/MANIFEST_URL\[STYLES\.(REALISTIC|ARTWORK)\]\s*=\s*"([^"]+)"/g)) {
    urls[m[1]] = m[2];
  }
  return urls;
}

function loadManifest(relUrl) {
  const abs = path.join(sarducaaDir, relUrl);
  return { abs, dir: path.dirname(abs), data: JSON.parse(readFileSync(abs, "utf8")) };
}

function resolvePlateFile(relFile) {
  return path.join(sarducaaDir, relFile);
}

function assertBounds(bounds, label) {
  assert.ok(Array.isArray(bounds) && bounds.length === 2, label + ": bounds must be a [[lat,lng],[lat,lng]] pair, got " + JSON.stringify(bounds));
  for (const pt of bounds) {
    assert.ok(Array.isArray(pt) && pt.length === 2, label + ": each bounds point must be [lat, lng]");
    for (const v of pt) {
      assert.ok(Number.isFinite(v), label + ": bounds coordinate must be a finite number, got " + JSON.stringify(v));
    }
  }
}

// ---------------------------------------------------------------------------
// Flat-schema plates: townplates + surfaceplates. Both are built by the same
// factory (map/plate-overlay.js's buildEntries/boundsFor), which dereferences
// exactly `plate.bounds`, `plate.file` and `plate.key` - nothing else is read
// by any of the three consumers (the live layer, surfaceBoundsFor, and
// surfacePlateFor). `metresPerPx`/`size`/`entrances` appear in the surface
// plate records today but are decorative: no import of map/surfaceplates.js,
// map/plate-overlay.js or map/poster-dungeon.js dereferences them, so they
// are deliberately not required here.
// ---------------------------------------------------------------------------

const FLAT_KINDS = [
  { noun: "town plates", sourceFile: "townplates.js" },
  { noun: "surface plates", sourceFile: "surfaceplates.js" }
];

for (const kind of FLAT_KINDS) {
  const urls = readManifestUrls(kind.sourceFile);

  test(kind.sourceFile + " declares both a REALISTIC and an ARTWORK manifest URL", () => {
    assert.ok(urls.REALISTIC, "missing MANIFEST_URL[STYLES.REALISTIC] in " + kind.sourceFile);
    assert.ok(urls.ARTWORK, "missing MANIFEST_URL[STYLES.ARTWORK] in " + kind.sourceFile);
  });

  for (const [styleName, relUrl] of Object.entries(urls)) {
    const style = styleName.toLowerCase();

    test(kind.noun + " (" + style + "): manifest parses and every plate has the key/file/bounds plate-overlay.js dereferences", () => {
      const { data } = loadManifest(relUrl);
      assert.ok(Array.isArray(data.plates) && data.plates.length > 0, relUrl + " must publish a non-empty `plates` array");
      const seenKeys = new Set();
      for (const plate of data.plates) {
        const label = relUrl + " plate " + JSON.stringify(plate.key);
        assert.equal(typeof plate.key, "string", label + ": key must be a string (plate-overlay.js looks plates up by it)");
        assert.ok(plate.key.length > 0, label + ": key must not be empty");
        assert.equal(typeof plate.file, "string", label + ": file must be a string (used directly as an L.imageOverlay URL)");
        assert.ok(plate.file.length > 0, label + ": file must not be empty");
        assertBounds(plate.bounds, label);
        assert.ok(!seenKeys.has(plate.key), relUrl + ": duplicate key " + JSON.stringify(plate.key) + " - the second entry is unreachable via boundsFor/surfacePlateFor's .find()");
        seenKeys.add(plate.key);
      }
    });

    test(kind.noun + " (" + style + "): every file the manifest names exists on disk at the path the page would fetch", () => {
      const { data } = loadManifest(relUrl);
      for (const plate of data.plates) {
        const abs = resolvePlateFile(plate.file);
        assert.ok(existsSync(abs), relUrl + ": plate " + JSON.stringify(plate.key) + " names " + plate.file + ", which does not exist (resolved to " + abs + ")");
      }
    });

    test(kind.noun + " (" + style + "): every image in its asset directory is named by a manifest entry", () => {
      const { dir, data } = loadManifest(relUrl);
      const referenced = new Set(data.plates.map((p) => path.basename(p.file)));
      const onDisk = readdirSync(dir).filter((f) => f.endsWith(".webp"));
      const orphans = onDisk.filter((f) => !referenced.has(f));
      assert.deepEqual(orphans, [], dir + ": image(s) not named by any plate in " + relUrl + " (orphaned by a republish that dropped the reference): " + orphans.join(", "));
    });
  }

  test(kind.noun + ": realistic and artwork manifests publish the same keys", () => {
    // switchStyle()/surfacePlateFor() only ever gate on the WHOLE manifest
    // being present (`set ? style : STYLES.REALISTIC` in plate-overlay.js);
    // there is no per-key fallback. A key present in one style and missing
    // from the other silently drops that one plate when the reader switches
    // style, rather than falling back to anything.
    const realistic = loadManifest(urls.REALISTIC).data;
    const artwork = loadManifest(urls.ARTWORK).data;
    const realisticKeys = new Set(realistic.plates.map((p) => p.key));
    const artworkKeys = new Set(artwork.plates.map((p) => p.key));
    const onlyRealistic = [...realisticKeys].filter((k) => !artworkKeys.has(k));
    const onlyArtwork = [...artworkKeys].filter((k) => !realisticKeys.has(k));
    assert.deepEqual(onlyRealistic, [], "key(s) published in the realistic " + kind.noun + " manifest but missing from the artwork one: " + onlyRealistic.join(", "));
    assert.deepEqual(onlyArtwork, [], "key(s) published in the artwork " + kind.noun + " manifest but missing from the realistic one: " + onlyArtwork.join(", "));
  });
}

// ---------------------------------------------------------------------------
// Nested-schema plates: dungeonplates. dungeonmode.js's own parseManifest
// dereferences `dungeon.key` (dungeons[d.key] / active.dungeons[key] lookups)
// and, per level, `level.level` (sort order and the level picker), `.file`
// (the imageOverlay/loadPlate source) and `.bounds`. `label` is read with a
// `|| key` fallback (optional), `metresPerPx` is read with a `|| 0.25`
// fallback (optional), and `depthM`/`sections` are read behind truthy guards
// in map/poster-dungeon.js's level panel (fmtDepth tolerates a missing
// depthM; `sections` is only rendered `if (lvl.sections)`) - none of those
// are required here. The dungeon's own outer `bounds` field (sibling to
// `key`/`label`/`levels`) is never read by any of dungeonmode.js or
// poster-dungeon.js, so it is not required either.
// ---------------------------------------------------------------------------

const dungeonUrls = readManifestUrls("dungeonmode.js");

test("dungeonmode.js declares both a REALISTIC and an ARTWORK manifest URL", () => {
  assert.ok(dungeonUrls.REALISTIC, "missing MANIFEST_URL[STYLES.REALISTIC] in dungeonmode.js");
  assert.ok(dungeonUrls.ARTWORK, "missing MANIFEST_URL[STYLES.ARTWORK] in dungeonmode.js");
});

for (const [styleName, relUrl] of Object.entries(dungeonUrls)) {
  const style = styleName.toLowerCase();

  test("dungeon plates (" + style + "): manifest parses and every dungeon/level has the fields dungeonmode.js dereferences", () => {
    const { data } = loadManifest(relUrl);
    assert.ok(Array.isArray(data.dungeons) && data.dungeons.length > 0, relUrl + " must publish a non-empty `dungeons` array");
    const seenDungeonKeys = new Set();
    for (const dungeon of data.dungeons) {
      const dlabel = relUrl + " dungeon " + JSON.stringify(dungeon.key);
      assert.equal(typeof dungeon.key, "string", dlabel + ": key must be a string (dungeons[d.key] / active.dungeons[key] lookups)");
      assert.ok(dungeon.key.length > 0, dlabel + ": key must not be empty");
      assert.ok(!seenDungeonKeys.has(dungeon.key), relUrl + ": duplicate dungeon key " + JSON.stringify(dungeon.key) + " - the second entry overwrites the first in dungeons[d.key]");
      seenDungeonKeys.add(dungeon.key);
      assert.ok(Array.isArray(dungeon.levels) && dungeon.levels.length > 0, dlabel + ": levels must be a non-empty array (a dungeon with no rendered level has nothing to enter)");
      const seenLevels = new Set();
      for (const lvl of dungeon.levels) {
        const llabel = dlabel + " level " + JSON.stringify(lvl.level);
        assert.equal(typeof lvl.level, "number", llabel + ": level must be a number (sorted via a.level - b.level)");
        assert.ok(Number.isFinite(lvl.level), llabel + ": level must be finite");
        assert.ok(!seenLevels.has(lvl.level), dlabel + ": duplicate level number " + JSON.stringify(lvl.level));
        seenLevels.add(lvl.level);
        assert.equal(typeof lvl.file, "string", llabel + ": file must be a string (used directly as an L.imageOverlay/loadPlate source)");
        assert.ok(lvl.file.length > 0, llabel + ": file must not be empty");
        assertBounds(lvl.bounds, llabel);
      }
    }
  });

  test("dungeon plates (" + style + "): every level file the manifest names exists on disk at the path the page would fetch", () => {
    const { data } = loadManifest(relUrl);
    for (const dungeon of data.dungeons) {
      for (const lvl of dungeon.levels) {
        const abs = resolvePlateFile(lvl.file);
        assert.ok(existsSync(abs), relUrl + ": " + dungeon.key + " level " + lvl.level + " names " + lvl.file + ", which does not exist (resolved to " + abs + ")");
      }
    }
  });

  test("dungeon plates (" + style + "): every image in its asset directory is named by a manifest entry", () => {
    const { dir, data } = loadManifest(relUrl);
    const referenced = new Set(data.dungeons.flatMap((d) => d.levels).map((lvl) => path.basename(lvl.file)));
    const onDisk = readdirSync(dir).filter((f) => f.endsWith(".webp"));
    const orphans = onDisk.filter((f) => !referenced.has(f));
    assert.deepEqual(orphans, [], dir + ": image(s) not named by any level in " + relUrl + " (orphaned by a republish that dropped the reference): " + orphans.join(", "));
  });
}

test("dungeon plates: realistic and artwork manifests publish the same dungeon keys and, within each shared dungeon, the same level numbers", () => {
  // Same reasoning as the flat kinds: dungeonmode.js's switchStyle() only
  // gates on the whole manifest being present, and enter()/stepTo() fall
  // back to `dungeon.levels[0]` when the requested level number is absent
  // from the newly-active style - a silent floor change, not an error, so a
  // per-level mismatch needs its own check beyond the per-dungeon one.
  const realistic = loadManifest(dungeonUrls.REALISTIC).data;
  const artwork = loadManifest(dungeonUrls.ARTWORK).data;
  const byKey = (data) => new Map(data.dungeons.map((d) => [d.key, d]));
  const realisticByKey = byKey(realistic);
  const artworkByKey = byKey(artwork);
  const realisticKeys = new Set(realisticByKey.keys());
  const artworkKeys = new Set(artworkByKey.keys());
  const onlyRealistic = [...realisticKeys].filter((k) => !artworkKeys.has(k));
  const onlyArtwork = [...artworkKeys].filter((k) => !realisticKeys.has(k));
  assert.deepEqual(onlyRealistic, [], "dungeon(s) published in the realistic manifest but missing from the artwork one: " + onlyRealistic.join(", "));
  assert.deepEqual(onlyArtwork, [], "dungeon(s) published in the artwork manifest but missing from the realistic one: " + onlyArtwork.join(", "));

  for (const key of realisticKeys) {
    if (!artworkKeys.has(key)) { continue; }
    const realisticLevels = new Set(realisticByKey.get(key).levels.map((l) => l.level));
    const artworkLevels = new Set(artworkByKey.get(key).levels.map((l) => l.level));
    const onlyInRealistic = [...realisticLevels].filter((l) => !artworkLevels.has(l));
    const onlyInArtwork = [...artworkLevels].filter((l) => !realisticLevels.has(l));
    assert.deepEqual(onlyInRealistic, [], key + ": level(s) " + onlyInRealistic.join(", ") + " published in realistic but missing from artwork");
    assert.deepEqual(onlyInArtwork, [], key + ": level(s) " + onlyInArtwork.join(", ") + " published in artwork but missing from realistic");
  }
});

// ---------------------------------------------------------------------------
// Tile pyramids. assets/tiles-art/v2/tiles.json is fetched at runtime by
// map/artwork-layer.js and map/artwork-raster.js, which dereference
// `urlTemplate`, `tileSize`, `minZoom`, `maxZoom`, `canvas.width/height` and,
// per level, `.z`/`.cols`/`.rows` - see artwork-layer.js's loadLayer() and
// artwork-raster.js's rectForIsland/planTiles. Its own `note` field is
// explicit that, unlike the realistic pyramid, a missing tile here is a
// fault: "this map draws its own sea, so unlike the realistic pyramid a
// missing file is a FAULT, not a transparent hole." So full coverage is
// asserted, generated the same way planTiles() builds a tile URL from the
// manifest (col in [0,cols), row in [0,rows), y = row - level.rows).
//
// assets/tiles/v4/tiles.json (the realistic pyramid) is NOT fetched at
// runtime - registry.js hardcodes its own copy of the same facts instead
// (url/tileSize/minNativeZoom/maxNativeZoom) - and its own note says a
// missing tile there is fine ("fully transparent, not an error"), so no
// coverage check applies; what IS checked is that registry.js's hardcoded
// copy has not drifted from the tiles.json the offline pipeline generated.
// ---------------------------------------------------------------------------

test("tiles-art manifest parses and carries the fields artwork-layer.js/artwork-raster.js dereference", () => {
  const { data } = loadManifest("assets/tiles-art/v2/tiles.json");
  assert.equal(typeof data.urlTemplate, "string", "urlTemplate must be a string (built into an L.tileLayer / substituted in planTiles)");
  assert.equal(typeof data.tileSize, "number", "tileSize must be a number");
  assert.equal(typeof data.minZoom, "number", "minZoom must be a number (passed straight to L.tileLayer)");
  assert.equal(typeof data.maxZoom, "number", "maxZoom must be a number (planTiles always renders at native maxZoom)");
  assert.ok(data.canvas && Number.isFinite(data.canvas.width) && Number.isFinite(data.canvas.height), "canvas.width/height must be finite numbers (rectForIsland/rectForBounds)");
  assert.ok(Array.isArray(data.levels) && data.levels.length > 0, "levels must be a non-empty array");
  for (const level of data.levels) {
    const label = "tiles-art level z=" + level.z;
    assert.equal(typeof level.z, "number", label + ": z must be a number (levelFor looks levels up by it)");
    assert.equal(typeof level.cols, "number", label + ": cols must be a number (bounds the col loop in planTiles)");
    assert.equal(typeof level.rows, "number", label + ": rows must be a number (bounds the row loop in planTiles)");
  }
  const level = data.levels.find((l) => l.z === data.maxZoom);
  assert.ok(level, "levels must include an entry for maxZoom=" + data.maxZoom + " (planTiles requires one and throws otherwise)");
});

test("tiles-art: every tile implied by its level grid exists on disk (its own note calls a missing tile a fault)", () => {
  const { data } = loadManifest("assets/tiles-art/v2/tiles.json");
  const missing = [];
  for (const level of data.levels) {
    for (let col = 0; col < level.cols; col++) {
      for (let row = 0; row < level.rows; row++) {
        const y = row - level.rows;
        const relUrl = data.urlTemplate.replace("{z}", level.z).replace("{x}", col).replace("{y}", y);
        if (!existsSync(resolvePlateFile(relUrl))) { missing.push(relUrl); }
      }
    }
  }
  assert.deepEqual(missing.slice(0, 20), [], (missing.length > 20 ? missing.length + " tiles missing, first 20: " : "tile(s) missing: ") + missing.slice(0, 20).join(", "));
});

test("tiles/v4 (realistic pyramid) manifest and registry.js's hardcoded tile config agree", () => {
  const { data } = loadManifest("assets/tiles/v4/tiles.json");
  const registryTiles = MAPS.sarducaa.tiles;
  assert.equal(registryTiles.url, data.urlTemplate, "registry.js's tiles.url has drifted from assets/tiles/v4/tiles.json's urlTemplate");
  assert.equal(registryTiles.tileSize, data.tileSize, "registry.js's tiles.tileSize has drifted from tiles.json's tileSize");
  assert.equal(registryTiles.minNativeZoom, data.minZoom, "registry.js's tiles.minNativeZoom has drifted from tiles.json's minZoom");
  assert.equal(registryTiles.maxNativeZoom, data.maxZoom, "registry.js's tiles.maxNativeZoom has drifted from tiles.json's maxZoom");
});
