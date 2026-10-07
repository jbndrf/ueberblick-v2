/**
 * The Standardansicht values and their checks (v3 `projectMapDefaultsSchema`, `reference/src/lib/schemas/map-settings.ts`).
 * The page's form and the server both call `validateMapView`, so a value is refused in one way in both places (R1).
 * The file side of the same rules is `MapSchema` (core): `min_zoom <= start.zoom <= max_zoom`, integers 0 to 24.
 */
import { defineRegistry, type KeyOf } from '@ueberblick/core';

export interface MapViewValues {
  readonly lat: number;
  readonly lng: number;
  readonly zoom: number;
  readonly minZoom: number;
  readonly maxZoom: number;
}

/** What the form shows while the project file has no `map.start`: v3's defaults (zoom 10, 1 to 19, Germany). */
export const MAP_VIEW_DEFAULTS: MapViewValues = {
  lat: 51.1657,
  lng: 10.4515,
  zoom: 10,
  minZoom: 1,
  maxZoom: 19,
};

export const ZOOM_MIN = 0;
export const ZOOM_MAX = 24;

export const MAP_VIEW_ERRORS = defineRegistry([
  { key: 'not_a_number', description: 'The field is empty or not a number.' },
  { key: 'lat_range', description: 'Latitude outside -90 to 90.' },
  { key: 'lng_range', description: 'Longitude outside -180 to 180.' },
  { key: 'zoom_range', description: 'A zoom outside 0 to 24.' },
  { key: 'zoom_integer', description: 'A zoom that is not a whole number.' },
  { key: 'min_above_max', description: 'The minimum zoom is above the maximum zoom.' },
  { key: 'zoom_below_min', description: 'The default zoom is below the minimum zoom.' },
  { key: 'zoom_above_max', description: 'The default zoom is above the maximum zoom.' },
] as const);
export type MapViewErrorCode = KeyOf<typeof MAP_VIEW_ERRORS>;
export type MapViewField = keyof MapViewValues;
export interface MapViewError {
  readonly field: MapViewField;
  readonly code: MapViewErrorCode;
}

const ZOOMS = ['zoom', 'minZoom', 'maxZoom'] as const;

export function validateMapView(v: MapViewValues): readonly MapViewError[] {
  const errors: MapViewError[] = [];
  const add = (field: MapViewField, code: MapViewErrorCode): void => void errors.push({ field, code });
  for (const f of ['lat', 'lng', ...ZOOMS] as const) if (!Number.isFinite(v[f])) add(f, 'not_a_number');
  const bad = (f: MapViewField): boolean => errors.some((e) => e.field === f);
  if (!bad('lat') && Math.abs(v.lat) > 90) add('lat', 'lat_range');
  if (!bad('lng') && Math.abs(v.lng) > 180) add('lng', 'lng_range');
  for (const f of ZOOMS) {
    if (bad(f)) continue;
    if (v[f] < ZOOM_MIN || v[f] > ZOOM_MAX) add(f, 'zoom_range');
    else if (!Number.isInteger(v[f])) add(f, 'zoom_integer');
  }
  if (ZOOMS.some(bad)) return errors;
  if (v.minZoom > v.maxZoom) add('minZoom', 'min_above_max');
  else {
    if (v.zoom < v.minZoom) add('zoom', 'zoom_below_min');
    if (v.zoom > v.maxZoom) add('zoom', 'zoom_above_max');
  }
  return errors;
}
