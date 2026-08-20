/*
 * The one global filter query — the single thing that narrows the map and
 * every registered source's row list at once.
 *
 * BOTTOM OF THE STACK, same shape as poi/state.js and discoveries/state.js: it
 * imports nothing from poi/, discoveries/, bookmarks/ or the registry layer,
 * so every layer's own visibility predicate and any consumer's row list can
 * both import IT without opening a cycle. That is what makes "one query,
 * three predicates" possible — nobody has to reach sideways into another
 * layer to read it.
 *
 * Before this there were two mechanisms doing overlapping jobs badly: a
 * per-tab search field in the old bookmark/pin panels (one query per source,
 * invisible from the other two tabs) and a #search box that made you PICK a
 * suggestion, which isolated ONE group and hid the other two catalogues
 * behind an empty Set (see the deleted poi/search.js). Neither could ever
 * show "iron OR salt across pins, bookmarks and discoveries at once", because
 * there was no single place holding what "the query" currently is. This is
 * that place.
 *
 * The matcher is compiled exactly ONCE PER QUERY CHANGE, not per row: a
 * catalogue of 1,562 discoveries filtered on every keystroke by a fresh
 * `new RegExp` per row would recompile the same pattern 1,562 times for one
 * character typed. setQuery() compiles once and every caller of matches()
 * reuses the result.
 *
 * NOT PERSISTED to localStorage — same reasoning
 * registry/sources-registry.js gives for editMode: a reload that silently
 * comes back with most of the map hidden behind a forgotten query from last
 * session is worse than an empty box.
 */

let raw = "";
let compiled = null;     // the compiled RegExp, or null when empty/invalid
let literalNeedle = "";  // lower-cased fallback text, used only when compiled is null and active
let literal = false;     // true when the pattern failed to compile and fell back
const listeners = [];

/** The raw text as typed, unmodified. */
export function getQuery() {
  return raw;
}

/** False for an empty or whitespace-only query — the "everything matches" state. */
export function isActive() {
  return raw.trim() !== "";
}

/** True when the current query failed to compile as a RegExp and fell back to a literal test. */
export function isLiteral() {
  return literal;
}

/** The compiled matcher, or null when the query is empty or fell back to a literal test. */
export function matcher() {
  return compiled;
}

function announce() {
  for (const fn of listeners) { fn(); }
}

/**
 * Recompiles the matcher and notifies every subscriber, once, regardless of
 * how many callers changed the text in the same turn — mirrors are guarded by
 * an unchanged-value check rather than a microtask because setQuery is already
 * called from a debounced input handler, not from a hot loop.
 */
export function setQuery(text) {
  const next = String(text === undefined || text === null ? "" : text);
  if (next === raw) { return; }
  raw = next;
  const q = raw.trim();
  if (!q) {
    compiled = null;
    literalNeedle = "";
    literal = false;
    announce();
    return;
  }
  try {
    compiled = new RegExp(q, "i");
    literalNeedle = "";
    literal = false;
  } catch {
    // A half-typed pattern — an open "(" or "[" — must not blank the map and
    // every list while the user is still typing it out.
    compiled = null;
    literalNeedle = q.toLowerCase();
    literal = true;
  }
  announce();
}

/** True when `haystack` matches the current query, or when there is no query at all. */
export function matches(haystack) {
  if (!isActive()) { return true; }
  const text = String(haystack === undefined || haystack === null ? "" : haystack);
  if (compiled) { return compiled.test(text); }
  return text.toLowerCase().indexOf(literalNeedle) !== -1;
}

/** Fires once per change, with no arguments — callers re-read what they need. */
export function subscribe(fn) {
  listeners.push(fn);
}
