// The base-layer reader for callers that draw plain tiles without MapLibre (the admin Standort preview). It is
// pure: `maplibre/basemaps.ts` takes only types from the MapLibre slice, so the library still loads on `mount` only.
export { basemapSpecs } from './maplibre/basemaps';
export type { TileProxy } from './maplibre/basemaps';
