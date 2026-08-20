#!/usr/bin/env node
/*
 * Bundles the shared map application — ONE build, the public/static one:
 *
 *   src/main-static.js  -> app/dist/app-static.js
 *   src/styles/main.css -> app/dist/app-static.css
 *
 * The application source lives once, at public/map/app/ — continents are thin
 * directories (public/map/<mapId>/) holding only an index.html that
 * references ../app/dist/*, plus that continent's own tile/plate assets.
 * TARGETS below still names exactly the Sarducaa index.html file: it grows
 * one entry per continent only once that continent ships its own published
 * registry entry and assets, not before.
 *
 * Then stamps a content hash into the dist references of index.html.
 *
 * Why a hash in the html rather than hashed FILENAMES: deployment is a plain
 * `rsync --delete` of the working tree onto a server with no Node, so dist/
 * is COMMITTED. Hashed filenames would accumulate dead files in a committed
 * directory and need a cleanup pass; a query stamp is a one-line diff per
 * build and cannot leave orphans behind. The stamp matters because .htaccess
 * sets no cache headers.
 *
 * Modes:
 *   (none)     build + stamp the target
 *   --watch    rebuild + stamp the target on change
 *   --verify   rebuild into a temp dir and fail if the committed dist/ or the
 *              html's stamps differ. This is the drift guard CI runs:
 *              committed build output is only trustworthy if something
 *              proves it still matches its source.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const mapsDir = join(repo, "public", "map");
const appDir = join(mapsDir, "app");
const srcDir = join(appDir, "src");
const distDir = join(appDir, "dist");
const sarducaaDir = join(mapsDir, "sarducaa");

// `name` is both the esbuild output basename (app-static.js / app-static.css)
// and the html-attribute match key, so the two can never drift apart.
const TARGET = { name: "app-static", entry: join(srcDir, "main-static.js"), html: join(sarducaaDir, "index.html") };

const mode = process.argv.includes("--watch")
  ? "watch"
  : process.argv.includes("--verify")
    ? "verify"
    : "build";

// Downlevelled for older embedded browser engines the map is also viewed
// through; keeping this target buys the source files modern syntax.
const ESBUILD_TARGET = ["chrome70"];

function options(outdir, target) {
  return {
    entryPoints: [target.entry, join(srcDir, "styles", "main.css")],
    outdir,
    entryNames: target.name,
    bundle: true,
    minify: true,
    sourcemap: true,
    target: ESBUILD_TARGET,
    format: "iife",
    legalComments: "none",
    // Image URLs inside CSS stay verbatim. A file loader would copy binary art
    // into a committed dist/ on every build, so the CSS sources instead write
    // asset paths relative to the OUTPUT directory (../assets/…). The globs
    // must tolerate a trailing ?v= cache stamp, so match on the directory.
    external: ["../assets/*", "*.webp", "*.png", "*.jpg", "*.svg", "*.woff2"],
    logLevel: "silent",
    loader: { ".svg": "text" }
  };
}

function shortHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 10);
}

function readOut(dir, name) {
  return readFileSync(join(dir, name));
}

/**
 * Rewrites the dist references for the target's html to carry the current
 * content hash. Returns the new html text (does not write it).
 */
function stampHtml(html, jsHash, cssHash, base) {
  const cssRe = new RegExp('href="\\.\\./app/dist/' + base + '\\.css(?:\\?v=[0-9a-f]*)?"');
  const jsRe = new RegExp('src="\\.\\./app/dist/' + base + '\\.js(?:\\?v=[0-9a-f]*)?"');
  return html
    .replace(cssRe, 'href="../app/dist/' + base + '.css?v=' + cssHash + '"')
    .replace(jsRe, 'src="../app/dist/' + base + '.js?v=' + jsHash + '"');
}

function assertStamped(html, base, htmlName) {
  const cssRe = new RegExp('href="\\.\\./app/dist/' + base + '\\.css(\\?v=[0-9a-f]*)?"');
  const jsRe = new RegExp('src="\\.\\./app/dist/' + base + '\\.js(\\?v=[0-9a-f]*)?"');
  if (!cssRe.test(html)) {
    throw new Error(htmlName + ' has no href="../app/dist/' + base + '.css" reference to stamp.');
  }
  if (!jsRe.test(html)) {
    throw new Error(htmlName + ' has no src="../app/dist/' + base + '.js" reference to stamp.');
  }
}

function stampInPlace(outdir, target) {
  const jsHash = shortHash(readOut(outdir, target.name + ".js"));
  const cssHash = shortHash(readOut(outdir, target.name + ".css"));
  const html = readFileSync(target.html, "utf8");
  const htmlName = "index.html";
  assertStamped(html, target.name, htmlName);
  const next = stampHtml(html, jsHash, cssHash, target.name);
  if (next !== html) { writeFileSync(target.html, next); }
  return { jsHash, cssHash };
}

async function build() {
  mkdirSync(distDir, { recursive: true });
  await esbuild.build(options(distDir, TARGET));
  const { jsHash, cssHash } = stampInPlace(distDir, TARGET);
  const js = readOut(distDir, TARGET.name + ".js").length;
  const css = readOut(distDir, TARGET.name + ".css").length;
  console.log(
    "built app/dist/" + TARGET.name + ".js " + (js / 1024).toFixed(1) + " KB (v=" + jsHash + "), " +
    "app/dist/" + TARGET.name + ".css " + (css / 1024).toFixed(1) + " KB (v=" + cssHash + ")"
  );
}

async function watch() {
  mkdirSync(distDir, { recursive: true });
  const ctx = await esbuild.context({
    ...options(distDir, TARGET),
    plugins: [{
      name: "stamp",
      setup(b) {
        b.onEnd(function (result) {
          if (result.errors.length) {
            for (const e of result.errors) { console.error(e.text); }
            return;
          }
          try {
            const h = stampInPlace(distDir, TARGET);
            console.log(new Date().toLocaleTimeString() + " rebuilt " + TARGET.name + " (js v=" + h.jsHash + ")");
          } catch (err) {
            console.error(String(err.message || err));
          }
        });
      }
    }]
  });
  await ctx.watch();
  console.log("watching " + srcDir);
}

async function verify() {
  const tmp = mkdtempSync(join(tmpdir(), "mo2-map-build-"));
  try {
    const problems = [];
    await esbuild.build(options(tmp, TARGET));
    for (const ext of ["js", "css"]) {
      const name = TARGET.name + "." + ext;
      let committed;
      try {
        committed = readOut(distDir, name);
      } catch {
        problems.push("dist/" + name + " is missing");
        continue;
      }
      if (!committed.equals(readOut(tmp, name))) {
        problems.push("dist/" + name + " does not match a fresh build of src/");
      }
    }
    const htmlName = "index.html";
    const html = readFileSync(TARGET.html, "utf8");
    assertStamped(html, TARGET.name, htmlName);
    const expected = stampHtml(
      html,
      shortHash(readOut(tmp, TARGET.name + ".js")),
      shortHash(readOut(tmp, TARGET.name + ".css")),
      TARGET.name
    );
    if (expected !== html) {
      problems.push(htmlName + " cache-busting stamps are stale");
    }
    if (problems.length) {
      console.error("build output has drifted from source:");
      for (const p of problems) { console.error("  - " + p); }
      console.error("\nRun `npm run build` and commit dist/ + index.html.");
      process.exitCode = 1;
      return;
    }
    console.log("dist/ matches src/ and index.html stamps are current");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const run = mode === "watch" ? watch : mode === "verify" ? verify : build;
run().catch(function (err) {
  console.error(String((err && err.message) || err));
  process.exitCode = 1;
});
