/*
 * One-time migration of this app's pre-multi-map localStorage keys - all
 * hardcoded `sarducaa.*` - to the per-map `mo2map.<mapId>.*` scheme
 * introduced alongside the map registry, plus the one key that stays global
 * (the admin API key: the same person's key works on every continent, see
 * bookmarks/config.js).
 *
 * Copies, never deletes, and never overwrites: a value already sitting under
 * a new key - because this already ran, or because the reader has since
 * changed a preference - is left exactly alone. An old key is left in place
 * rather than removed, so a copy that never runs to completion (a private
 * window, a quota error) can never leave a returning user worse off than
 * before this shipped.
 *
 * Runs as this file's own side effect, imported first by main.js/
 * main-static.js - before anything else, including discoveries/state.js,
 * which reads its own prefs key at module load time (its trailing
 * `loadPrefs();` call), not lazily on first use. A migration that ran after
 * that read would be too late for the very first page load.
 */
import { currentMapId } from "../map/current.js";

// [oldKey, newKey] - never depended on which continent's page happens to be
// open, because only Sarducaa ever had an unprefixed key to migrate FROM.
const GLOBAL_KEYS = [["sarducaa.api-key", "mo2map.api-key"]];

// Suffixes of the single-value per-map keys: sarducaa.<oldSuffix> -> mo2map.
// <mapId>.<newSuffix>. Same suffix on both sides except the tab item, which
// the registry has since renamed (registry/sources-registry.js's TAB_ITEM).
const PER_MAP_SUFFIX_PAIRS = [
  ["style", "style"],
  ["manage-tab", "active-tab"],
  ["bm-prefs", "bm-prefs"],
  ["discovery-prefs", "discovery-prefs"]
];

// The registry's per-source view prefs used to live under one key per
// registered source at sarducaa.<the old prefix below><sourceId> (e.g.
// sarducaa.….pins), unknown in advance, so migrated by walking every stored
// key under that OLD prefix rather than naming each source here. The target
// prefix is registry/sources-registry.js's own PREFS_PREFIX suffix, renamed
// since; only the literal string on the left is historical data this file
// has to keep matching verbatim.
const LEGACY_SOURCE_PREFS_PREFIX = "sarducaa.manage.";

function copyIfAbsent(oldKey, newKey) {
  try {
    if (window.localStorage.getItem(newKey) !== null) { return; }
    const value = window.localStorage.getItem(oldKey);
    if (value !== null) { window.localStorage.setItem(newKey, value); }
  } catch {
    /* private mode, or quota exceeded - old key is still there untouched */
  }
}

function migrate() {
  for (const [oldKey, newKey] of GLOBAL_KEYS) { copyIfAbsent(oldKey, newKey); }

  // The per-map keys below were always literally "sarducaa.*" - migrating
  // them onto a DIFFERENT continent's page would silently hand that
  // continent Sarducaa's old style/tab/prefs, which is wrong, not helpful.
  const mapId = currentMapId();
  if (mapId !== "sarducaa") { return; }

  for (const [oldSuffix, newSuffix] of PER_MAP_SUFFIX_PAIRS) {
    copyIfAbsent("sarducaa." + oldSuffix, "mo2map." + mapId + "." + newSuffix);
  }

  try {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i++) { keys.push(window.localStorage.key(i)); }
    for (const key of keys) {
      if (key && key.indexOf(LEGACY_SOURCE_PREFS_PREFIX) === 0) {
        const suffix = key.slice(LEGACY_SOURCE_PREFS_PREFIX.length);
        copyIfAbsent(key, "mo2map." + mapId + ".source." + suffix);
      }
    }
  } catch {
    /* private mode */
  }
}

migrate();
