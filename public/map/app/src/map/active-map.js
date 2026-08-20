/*
 * Which map the page is showing: the current continent's surface, or one
 * dungeon LEVEL on it.
 *
 * A continent is not one map. Its own id (map/current.js, read from the URL)
 * is the surface; every rendered dungeon level is its own map
 * (`<mapId>/<dungeonKey>/<level>`, the `maps` table from migration 020,
 * published per level by dungeon_plate.py so the id is assembled in exactly
 * one place). Every marker, bookmark and discovery states the map it is on,
 * and the page shows the records of the map you are looking at.
 *
 * This replaced inferring a level from coordinates, which cannot be made to
 * work: the levels of one dungeon are stacked storeys whose outlines overlap
 * almost completely, so a bounds test put all three of Yel Keskar's surface
 * doors and the boss room from the bottom floor onto every panel of every
 * level. Position answers "where"; only the map answers "which floor".
 *
 * The state is one string plus subscribers - deliberately not a store, not a
 * localStorage key: the active map is a property of where the reader currently
 * IS (dungeonmode.js owns entering and leaving), so persisting it across reloads
 * would strand a visitor on a dungeon floor with no plate on screen.
 */
import { currentMapId } from "./current.js";

// Computed once, at module init, from the URL this page was loaded at - not
// a literal. Every consumer still imports it as a plain constant (dungeonmode
// .js, poster-dungeon.js): the value never changes within one page load, only
// where it comes from did.
export const SURFACE_MAP = currentMapId();

let active = SURFACE_MAP;
const subscribers = [];

export function activeMapId() {
  return active;
}

export function isSurface() {
  return active === SURFACE_MAP;
}

/**
 * Switches maps and notifies subscribers. Re-setting the same map is a no-op, so
 * a caller may set it unconditionally (dungeonmode.js does, on every level
 * repaint) without triggering a marker-layer rebuild per frame.
 */
export function setActiveMap(mapId) {
  const next = mapId || SURFACE_MAP;
  if (next === active) return;
  active = next;
  for (const fn of subscribers) {
    try {
      fn(active);
    } catch (err) {
      // One bad subscriber must not strand the others on the old map.
      console.warn("map change subscriber failed:", err && err.message);
    }
  }
}

/** Subscribes to map changes. Returns an unsubscribe function. */
export function onMapChange(fn) {
  subscribers.push(fn);
  return function () {
    const at = subscribers.indexOf(fn);
    if (at >= 0) subscribers.splice(at, 1);
  };
}

/**
 * The map a record belongs to, for records written before maps existed.
 *
 * A row with no `map` is a surface row: that is the column default the migration
 * chose, so old rows and old clients are correct by construction rather than by
 * backfill, and this is the one place the client applies the same rule.
 */
export function mapOf(record) {
  const value = record && record.map;
  return typeof value === "string" && value !== "" ? value : SURFACE_MAP;
}

/** True when `record` belongs on the map currently shown. */
export function onActiveMap(record) {
  return mapOf(record) === active;
}
