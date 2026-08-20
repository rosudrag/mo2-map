import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMapServer } from "../server/serve.mjs";

/*
 * Contract tests for the server. Each one fails on a plausible mistake:
 * serving a sidecar's bytes under the wrong Content-Type, caching an HTML page
 * for a year, letting a percent-encoded traversal through, or losing the query
 * string on a directory redirect.
 *
 * A temporary fixture tree is built once and removed at the end. Real files,
 * real sockets, real fetch — nothing is mocked, because the bugs this file
 * exists to catch live in the interaction between fs and http.
 */

let sandbox;
let root;
let server;
let base;

test.before(async () => {
  // Two levels: the sandbox holds a file the server must never reach, and the
  // served root is a directory inside it. A marker placed INSIDE the root
  // would prove nothing — a neutralised `..` resolves back into the root and
  // would "pass" while testing the wrong thing.
  sandbox = await mkdtemp(join(tmpdir(), "mo2-map-server-"));
  root = join(sandbox, "site");
  await mkdir(root, { recursive: true });
  await writeFile(join(sandbox, "outside.txt"), "OUTSIDE-THE-ROOT-MARKER");
  await writeFile(join(root, "index.html"), "<!doctype html><title>root</title>");
  await writeFile(join(root, "data.json"), '{"ok":true}');
  await writeFile(join(root, "app.css"), "body{color:red}");
  // A brotli sidecar. The bytes are not real brotli — nothing here decompresses
  // them, and using a recognisable marker makes a wrong-file bug obvious.
  await writeFile(join(root, "app.css.br"), "BROTLI-SIDECAR");
  await writeFile(join(root, "app.css.gz"), "GZIP-SIDECAR");
  await mkdir(join(root, "map", "sarducaa", "assets", "tiles", "v4", "0"), { recursive: true });
  await writeFile(join(root, "map", "sarducaa", "index.html"), "<!doctype html><title>sarducaa</title>");
  await writeFile(join(root, "map", "sarducaa", "assets", "tiles", "v4", "0", "1.webp"), "WEBP");

  server = createMapServer({ root, quiet: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  await rm(sandbox, { recursive: true, force: true });
});

test("serves a file with the right type and an ETag", async () => {
  const res = await fetch(`${base}/index.html`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  assert.ok(res.headers.get("etag"), "an ETag is required for revalidation to work at all");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(await res.text(), /root/);
});

test("a returned ETag produces a 304 with no body", async () => {
  const first = await fetch(`${base}/index.html`);
  const etag = first.headers.get("etag");
  await first.text();

  const second = await fetch(`${base}/index.html`, { headers: { "If-None-Match": etag } });
  assert.equal(second.status, 304);
  assert.equal(await second.text(), "", "a 304 must not carry a body");
});

test("If-Modified-Since also revalidates", async () => {
  const res = await fetch(`${base}/index.html`, {
    headers: { "If-Modified-Since": new Date(Date.now() + 60000).toUTCString() }
  });
  assert.equal(res.status, 304);
});

test("missing files are 404, not 500", async () => {
  const res = await fetch(`${base}/nope.html`);
  assert.equal(res.status, 404);
});

test("path traversal never reaches outside the served root", async () => {
  // `outside.txt` exists one level above the root. Every one of these targets
  // is a way of asking for it; all of them must fail to produce its contents.
  // A leading `..` normalises away rather than escaping, so 404 is the honest
  // answer — what matters is that the marker never appears in a body.
  for (const target of [
    "/%2e%2e%2foutside.txt",
    "/..%2Foutside.txt",
    "/%2e%2e/%2e%2e/outside.txt",
    "/a/b/%2e%2e/%2e%2e/%2e%2e/outside.txt",
    "/%2e%2e%5coutside.txt"
  ]) {
    const res = await fetch(base + target);
    const body = await res.text();
    assert.doesNotMatch(body, /OUTSIDE-THE-ROOT-MARKER/, `${target} escaped the root`);
    assert.ok(res.status === 400 || res.status === 404, `${target} gave ${res.status}`);
  }
});

test("a null byte in the path is refused", async () => {
  const res = await fetch(`${base}/index.html%00.txt`);
  assert.equal(res.status, 400);
});

test("brotli sidecar is served when accepted, raw file when not", async () => {
  const br = await fetch(`${base}/app.css`, { headers: { "Accept-Encoding": "br" } });
  assert.equal(br.status, 200);
  assert.equal(br.headers.get("content-encoding"), "br");
  // The type comes from the original path, not the sidecar's extension.
  assert.equal(br.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(br.headers.get("vary"), "Accept-Encoding");

  const raw = await fetch(`${base}/app.css`, { headers: { "Accept-Encoding": "identity" } });
  assert.equal(raw.status, 200);
  assert.equal(raw.headers.get("content-encoding"), null);
  assert.equal(await raw.text(), "body{color:red}");
});

test("gzip is used when brotli is not accepted", async () => {
  const res = await fetch(`${base}/app.css`, { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(res.headers.get("content-encoding"), "gzip");
});

test("an encoding refused with q=0 is not used", async () => {
  const res = await fetch(`${base}/app.css`, { headers: { "Accept-Encoding": "br;q=0, gzip" } });
  assert.equal(res.headers.get("content-encoding"), "gzip", "br;q=0 is a refusal, not a preference");
});

test("tiles are immutable and HTML is never cached", async () => {
  const tile = await fetch(`${base}/map/sarducaa/assets/tiles/v4/0/1.webp`);
  assert.equal(tile.headers.get("content-type"), "image/webp");
  assert.match(tile.headers.get("cache-control"), /immutable/);
  assert.match(tile.headers.get("cache-control"), /max-age=31536000/);
  await tile.arrayBuffer();

  const html = await fetch(`${base}/map/sarducaa/`);
  assert.equal(html.headers.get("cache-control"), "no-cache",
    "a cached HTML page pins visitors to a previous deploy's bundles");
  await html.text();
});

test("a ?v= stamp makes any asset immutable", async () => {
  const res = await fetch(`${base}/app.css?v=abc123`, { headers: { "Accept-Encoding": "identity" } });
  assert.match(res.headers.get("cache-control"), /immutable/);
  await res.text();
});

test("json gets a short cache, not a year", async () => {
  const res = await fetch(`${base}/data.json`);
  assert.equal(res.headers.get("cache-control"), "public, max-age=300");
  await res.text();
});

test("HEAD matches GET's headers and sends no body", async () => {
  const get = await fetch(`${base}/index.html`);
  await get.text();
  const head = await fetch(`${base}/index.html`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-type"), get.headers.get("content-type"));
  assert.equal(head.headers.get("content-length"), get.headers.get("content-length"));
  assert.equal(head.headers.get("etag"), get.headers.get("etag"));
  assert.equal(await head.text(), "");
});

test("other methods are 405 with an Allow header", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const res = await fetch(`${base}/index.html`, { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET, HEAD");
  }
});

test("a directory without a trailing slash redirects and keeps the query", async () => {
  const res = await fetch(`${base}/map/sarducaa?z=3&x=1`, { redirect: "manual" });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "/map/sarducaa/?z=3&x=1",
    "dropping the query on this redirect silently loses deep links");
});

test("a directory with a trailing slash serves its index", async () => {
  const res = await fetch(`${base}/map/sarducaa/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /sarducaa/);
});

test("a directory with no index is 404, not a listing", async () => {
  const res = await fetch(`${base}/map/sarducaa/assets/`);
  assert.equal(res.status, 404, "directory listings leak structure and were never wanted");
  await res.text();
});
