/*
 * The one thing every static source needs: a committed JSON snapshot instead
 * of a live endpoint. Deliberately not src/config.js's API_BASE — that constant
 * is site-relative API configuration and this build has no API. The path is
 * page-relative, exactly like poi/api.js's BASE, and points at data/static/,
 * the directory the public build's fixtures are published under.
 */
const BASE = "data/static/";

/** Fetches and parses one committed snapshot file, e.g. "pins.json". */
export function loadSnapshot(name) {
  return fetch(BASE + name, { cache: "no-store" }).then(function (r) {
    if (!r.ok) { throw new Error(name + " " + r.status); }
    return r.json();
  });
}
