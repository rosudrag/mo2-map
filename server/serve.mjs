#!/usr/bin/env node
/*
 * The map's HTTP server: static files, precompressed sidecars, conditional
 * requests. Node standard library only — no dependencies, here or anywhere in
 * this repo.
 *
 * It is meant to run behind a reverse proxy (see ../Caddyfile), so it
 * deliberately does NOT do TLS, HTTP/2, HTTP/3, or on-the-fly compression:
 * the proxy already does all four, and doing them twice buys nothing and
 * spends CPU on every request. What is left is the part a proxy cannot do for
 * us — knowing which of our files are immutable and which must never be
 * cached.
 *
 * Why run an app server at all for a static tree? So that local development
 * and production serve the same bytes with the same headers. A proxy
 * configured to serve files directly (the commented alternative in the
 * Caddyfile) would work in production and diverge from every developer's
 * machine, which is how a caching bug reaches users.
 */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const MIME = new Map(Object.entries({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8"
}));

/*
 * Cache policy, and the reason it is not one rule.
 *
 * A map tile and an HTML page have opposite failure modes. A tile at
 * .../tiles/v5/0/12/-7.webp is content-addressed by its path: that URL will
 * never hold different bytes, because a rebuilt pyramid becomes v6. Caching it
 * for a year is free. An HTML page is the opposite: it carries the ?v= stamps
 * that point at the current bundles, so a stale copy pins a visitor to a
 * previous deploy's JavaScript. It must be revalidated every time.
 *
 * `no-cache` does not mean "do not store" — it means "revalidate before
 * reuse", which with the ETag below costs one 304 and no body.
 */
const IMMUTABLE = /\/(?:tiles|tiles-art|townplates|townplates-art|dungeonplates|dungeonplates-art)(?:-art)?\//;
const YEAR = 31536000;

/*
 * `filePath` is the RESOLVED file, not the request path, and that distinction
 * is load-bearing: a request for `/map/sarducaa/` serves index.html, and
 * deciding from the URL would hand that page a one-hour cache — pinning
 * visitors to a previous deploy's bundles at exactly the URL people actually
 * visit. The URL is still consulted for `?v=`, which is a property of the
 * request rather than the file.
 */
function cacheControl(filePath, urlPathname, hasVersionQuery) {
  if (filePath.endsWith(".html")) return "no-cache";
  // A ?v= stamp is a promise from the builder that this URL's bytes are fixed.
  if (hasVersionQuery || IMMUTABLE.test(urlPathname)) {
    return `public, max-age=${YEAR}, immutable`;
  }
  if (filePath.endsWith(".json")) return "public, max-age=300";
  return "public, max-age=3600";
}

/*
 * THE ONE SECURITY-RELEVANT FUNCTION IN THIS FILE.
 *
 * Everything else here is plumbing; this is what stops `GET /../../etc/passwd`
 * and its percent-encoded variants from reading outside the served tree. It
 * decodes first and resolves second, because deciding safety before decoding
 * is how traversal bugs survive review. Returns null for anything suspect and
 * the caller turns that into a 400 or 404 — never a thrown exception, because
 * an unhandled throw in a request handler is a crash, not a rejection.
 */
function safeResolve(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes("\0")) return null;
  const candidate = resolve(join(root, normalize(decoded)));
  // `startsWith(root)` alone would accept a sibling directory whose name
  // merely begins with the root's name, hence the separator check.
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

/** Weak ETag: size and mtime identify a file's bytes well enough to revalidate. */
function etagFor(st) {
  return `W/"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
}

function notModified(req, etag, st) {
  const inm = req.headers["if-none-match"];
  if (inm && inm.split(",").some((t) => t.trim() === etag)) return true;
  const ims = req.headers["if-modified-since"];
  if (ims) {
    const since = Date.parse(ims);
    // Second granularity: mtimeMs floored, or a file written mid-second
    // revalidates forever.
    if (Number.isFinite(since) && Math.floor(st.mtimeMs / 1000) * 1000 <= since) return true;
  }
  return false;
}

function acceptsEncoding(req, name) {
  const header = req.headers["accept-encoding"];
  if (!header) return false;
  return header.split(",").some((part) => {
    const [enc, ...params] = part.trim().split(";");
    if (enc !== name && enc !== "*") return false;
    // q=0 is an explicit refusal, and it is not hypothetical: curl and some
    // proxies use it to disable one encoding while keeping others.
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return !q || Number(q.slice(2)) > 0;
  });
}

async function statFile(path) {
  try {
    const st = await stat(path);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

/*
 * Precompressed sidecars: the build writes foo.css.br beside foo.css, and we
 * hand it over verbatim when the client takes brotli. Compressing per request
 * would burn CPU recomputing a byte-identical answer, and the proxy in front
 * would often just do it again.
 */
async function pickEncoded(req, path) {
  if (acceptsEncoding(req, "br")) {
    const st = await statFile(path + ".br");
    if (st) return { path: path + ".br", st, encoding: "br" };
  }
  if (acceptsEncoding(req, "gzip")) {
    const st = await statFile(path + ".gz");
    if (st) return { path: path + ".gz", st, encoding: "gzip" };
  }
  const st = await statFile(path);
  return st ? { path, st, encoding: null } : null;
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  if (body === undefined) res.end();
  else res.end(body);
}

export function createMapServer({ root, quiet = false } = {}) {
  const rootDir = resolve(root);

  const log = (req, status, bytes, startedAt) => {
    if (quiet) return;
    const ms = (Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(1);
    // Method, path, status, bytes, duration. Never headers: they carry
    // credentials in some deployments and there is no reason to keep them.
    process.stdout.write(`${req.method} ${req.url} ${status} ${bytes}b ${ms}ms\n`);
  };

  return createServer(async (req, res) => {
    const startedAt = process.hrtime.bigint();
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        send(res, 405, { "Allow": "GET, HEAD", "Content-Length": "0" });
        return log(req, 405, 0, startedAt);
      }

      // A relative URL base is never used — it only satisfies the parser for
      // origin-form request targets, which is all a server receives.
      const url = new URL(req.url, "http://localhost");
      const filePath = safeResolve(rootDir, url.pathname);
      if (filePath === null) {
        send(res, 400, { "Content-Type": "text/plain; charset=utf-8" }, "Bad request\n");
        return log(req, 400, 0, startedAt);
      }

      // Directories: serve index.html, but only from a slashed URL, or every
      // relative asset reference inside that page resolves one level too high.
      let target = filePath;
      let dirStat = null;
      try {
        const st = await stat(filePath);
        if (st.isDirectory()) dirStat = st;
      } catch { /* falls through to the 404 below */ }

      if (dirStat) {
        if (!url.pathname.endsWith("/")) {
          const location = url.pathname + "/" + (url.search || "");
          send(res, 301, { "Location": location, "Content-Length": "0" });
          return log(req, 301, 0, startedAt);
        }
        target = join(filePath, "index.html");
      }

      const found = await pickEncoded(req, target);
      if (!found) {
        send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found\n");
        return log(req, 404, 0, startedAt);
      }

      // Content-Type comes from the ORIGINAL path, never the sidecar: the type
      // of foo.css.br is still CSS, and the encoding says how it is wrapped.
      const type = MIME.get(extname(target).toLowerCase()) || "application/octet-stream";
      const etag = etagFor(found.st);
      const headers = {
        "Content-Type": type,
        "Cache-Control": cacheControl(target, url.pathname, url.searchParams.has("v")),
        "ETag": etag,
        "Last-Modified": new Date(found.st.mtimeMs).toUTCString(),
        "Vary": "Accept-Encoding",
        "X-Content-Type-Options": "nosniff"
      };
      if (found.encoding) headers["Content-Encoding"] = found.encoding;

      if (notModified(req, etag, found.st)) {
        // A 304 carries no body and no Content-Length, per RFC 9110.
        send(res, 304, headers);
        return log(req, 304, 0, startedAt);
      }

      headers["Content-Length"] = String(found.st.size);

      if (req.method === "HEAD") {
        send(res, 200, headers);
        return log(req, 200, 0, startedAt);
      }

      // Range requests are NOT implemented. Every file here is small — the
      // largest is a few hundred KB — so a partial-content path would add a
      // second, subtler code path for no measurable gain. Whole file, always.
      res.writeHead(200, headers);
      const stream = createReadStream(found.path);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
      res.on("finish", () => log(req, 200, found.st.size, startedAt));
    } catch (err) {
      if (!res.headersSent) {
        send(res, 500, { "Content-Type": "text/plain; charset=utf-8" }, "Internal error\n");
      } else {
        res.destroy();
      }
      if (!quiet) process.stderr.write(`error handling ${req.url}: ${err.message}\n`);
    }
  });
}

// ---- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { root: "./public", port: 8788, host: "127.0.0.1", quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--quiet") { opts.quiet = true; continue; }
    if (arg === "--root" || arg === "--port" || arg === "--host") {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      opts[arg.slice(2)] = arg === "--port" ? Number(value) : value;
      continue;
    }
    // Unknown flags are an error, not a shrug: a typo'd --quite that silently
    // did nothing would be discovered by someone reading logs that never came.
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) {
    throw new Error(`--port must be 0-65535, got ${opts.port}`);
  }
  return opts;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;

if (isMain) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n\nusage: node server/serve.mjs [--root DIR] [--port N] [--host ADDR] [--quiet]\n`);
    process.exit(2);
  }

  const rootDir = resolve(opts.root);
  const st = await stat(rootDir).catch(() => null);
  if (!st || !st.isDirectory()) {
    process.stderr.write(`site root is not a directory: ${rootDir}\n`);
    process.exit(1);
  }

  const server = createMapServer({ root: rootDir, quiet: opts.quiet });
  server.listen(opts.port, opts.host, () => {
    const { address, port } = server.address();
    const host = address === "::" || address === "0.0.0.0" ? "localhost" : address;
    process.stdout.write(`serving ${rootDir}\n  http://${host}:${port}/\n`);
  });

  // Graceful shutdown: stop accepting, let in-flight responses finish. Without
  // closeIdleConnections() a keep-alive client holds the process open until
  // its socket times out, which reads as a hung Ctrl-C.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      server.closeIdleConnections();
    });
  }
}
