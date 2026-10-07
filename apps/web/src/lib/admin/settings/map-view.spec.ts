import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAP_VIEW_DEFAULTS, validateMapView, type MapViewValues } from './map-view';

const ok: MapViewValues = { lat: 51.1657, lng: 10.4515, zoom: 10, minZoom: 1, maxZoom: 19 };

describe('validateMapView (v3 projectMapDefaultsSchema, plus the order of the three zooms)', () => {
  it('accepts v3 defaults', () => {
    expect(validateMapView(MAP_VIEW_DEFAULTS)).toEqual([]);
    expect(MAP_VIEW_DEFAULTS).toEqual(ok);
  });
  it('names each field that is out of range', () => {
    expect(validateMapView({ ...ok, lat: 91 })).toEqual([{ field: 'lat', code: 'lat_range' }]);
    expect(validateMapView({ ...ok, lng: -181 })).toEqual([{ field: 'lng', code: 'lng_range' }]);
    expect(validateMapView({ ...ok, zoom: 25, maxZoom: 24 })).toContainEqual({
      field: 'zoom',
      code: 'zoom_range',
    });
    expect(validateMapView({ ...ok, minZoom: -1 })).toContainEqual({ field: 'minZoom', code: 'zoom_range' });
    expect(validateMapView({ ...ok, maxZoom: 30 })).toContainEqual({ field: 'maxZoom', code: 'zoom_range' });
  });
  it('refuses fractions and non-numbers', () => {
    expect(validateMapView({ ...ok, zoom: 10.5 })).toContainEqual({ field: 'zoom', code: 'zoom_integer' });
    expect(validateMapView({ ...ok, lat: Number.NaN })).toContainEqual({
      field: 'lat',
      code: 'not_a_number',
    });
  });
  it('refuses min above max and a zoom outside them', () => {
    expect(validateMapView({ ...ok, minZoom: 12, maxZoom: 5, zoom: 8 })).toContainEqual({
      field: 'minZoom',
      code: 'min_above_max',
    });
    expect(validateMapView({ ...ok, zoom: 0 })).toContainEqual({ field: 'zoom', code: 'zoom_below_min' });
    expect(validateMapView({ ...ok, zoom: 20 })).toContainEqual({ field: 'zoom', code: 'zoom_above_max' });
  });
  it('property: valid exactly when ranges hold and min <= zoom <= max', () => {
    const z = fc.integer({ min: -2, max: 26 });
    fc.assert(
      fc.property(z, z, z, (minZoom, zoom, maxZoom) => {
        const valid = validateMapView({ ...ok, minZoom, zoom, maxZoom }).length === 0;
        const inRange = [minZoom, zoom, maxZoom].every((v) => v >= 0 && v <= 24);
        expect(valid).toBe(inRange && minZoom <= zoom && zoom <= maxZoom);
      }),
    );
  });
});
