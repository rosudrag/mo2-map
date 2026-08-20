# Running the site

The site is static files. `server/serve.mjs` serves them, using only Node's
standard library — this repo has no runtime dependencies and the server does
not add any.

## Locally

```powershell
./local.ps1                                   # serves ./public on :8788
./local.ps1 -Port 9000 -NoBrowser
./local.ps1 -SiteRoot path/to/a/static/site
```

`local.ps1` finds Node itself (PATH first, then the usual Windows install
locations), refuses to start on a missing or empty site root, and runs the
server in the foreground so Ctrl-C shuts it down cleanly.

Directly, on any platform:

```bash
node server/serve.mjs --root public --port 8788
```

| Flag | Default | Meaning |
|---|---|---|
| `--root` | `./public` | directory to serve |
| `--port` | `8788` | TCP port; `0` picks a free one |
| `--host` | `127.0.0.1` | bind address — loopback by design, see below |
| `--quiet` | off | silence the request log |

Unknown flags are an error rather than being ignored, so a typo cannot leave
you wondering why nothing happened.

## Behind a proxy

See [`../Caddyfile`](../Caddyfile). Caddy terminates TLS and does HTTP/2,
HTTP/3 and compression; the Node server serves files and sets cache headers.
It binds to loopback by default so the origin is not directly reachable.

Nothing in the server is Caddy-specific — any reverse proxy works.

## Caching

The two failure modes here are opposite, which is why there is not one rule.

| What | Header | Why |
|---|---|---|
| Map tiles and plates | `max-age=31536000, immutable` | the path is the version — a rebuilt pyramid becomes `v5`, so `v4/0/12/-7.webp` never changes |
| Anything requested with `?v=` | `max-age=31536000, immutable` | the stamp is the builder's promise that these bytes are fixed |
| HTML | `no-cache` | it carries the `?v=` stamps; a stale copy pins a visitor to a previous deploy's JavaScript |
| JSON | `max-age=300` | data changes on its own schedule, and five minutes stale is harmless |
| Everything else | `max-age=3600` | |

`no-cache` means "revalidate before reuse", not "do not store". With the ETag
the server sends, a revalidation costs one `304` and no body.

Cache policy is decided from the **resolved file**, not the request path — a
request for `/map/sarducaa/` serves `index.html` and must get `no-cache`, which
a URL-based rule would get wrong at exactly the address people visit.

## Compression

The server serves precompressed sidecars when they exist: `app.css.br` for a
client that accepts brotli, then `app.css.gz`, then the plain file. It never
compresses on the fly, because the proxy in front already does and computing
the same answer twice is waste. If no sidecars exist, the proxy compresses and
everything still works.

## What the server does not do

- **TLS, HTTP/2, HTTP/3** — the proxy's job.
- **Range requests.** Every file is small; a `206` path would add a subtler
  second code path for no measurable gain. Whole files, always.
- **Directory listings.** A directory serves `index.html` or 404s.

## Tests

```bash
node --test 'test/*.test.mjs'
```

`test/server.test.mjs` starts the real server on an ephemeral port and drives
it over HTTP: content types, `304` from an ETag, path traversal, encoding
negotiation, the cache rules above, `HEAD`, `405`, and the directory redirect
keeping its query string.
