import { currentMapId } from "./current.js";
import { MAPS } from "../../../registry.js";

// The map art + projection descriptor, published by public/map/registry.js
// as a named export keyed by map id. Split out from map/instance.js so
// projection.js can read the calibration without importing the Leaflet map
// (which would make every pure coordinate helper depend on a live DOM
// container).
export const mapMeta = MAPS[currentMapId()];
export const img = mapMeta.image;
