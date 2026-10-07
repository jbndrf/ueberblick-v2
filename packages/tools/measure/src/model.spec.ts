import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGeo, type Position } from '@ueberblick/core/geo';
import { formatArea, formatLength, measure, overlayOf } from './model';

const geo = createGeo();
// about 100 m x 100 m near Stuttgart
const SQUARE: Position[] = [
  [9.0, 48.0],
  [9.0013, 48.0],
  [9.0013, 48.0009],
  [9.0, 48.0009],
];
const first = SQUARE[0] as Position;

describe('measure model', () => {
  it('nothing to measure below two points (distance) or three points (area)', () => {
    expect(measure(geo, 'distance', [])).toEqual({ state: 'empty' });
    expect(measure(geo, 'distance', [[9, 48]])).toEqual({ state: 'empty' });
    expect(measure(geo, 'area', SQUARE.slice(0, 2)).state).toBe('empty');
  });

  it('distance is core.geo: the derived length of the line and the last leg by distanceM', () => {
    const r = measure(geo, 'distance', SQUARE);
    if (r.state !== 'ok' || r.mode !== 'distance') throw new Error('expected a distance');
    const line = { type: 'LineString', coordinates: SQUARE } as const;
    expect(r.lengthM).toBe(geo.derive(line).lengthM);
    const a = SQUARE[2] as Position;
    const b = SQUARE[3] as Position;
    expect(r.lastLegM).toBe(
      geo.distanceM({ type: 'Point', coordinates: a }, { type: 'Point', coordinates: b }),
    );
    expect(r.lengthM).toBeGreaterThan(250);
  });

  it('area is core.geo: the derived area and perimeter of the closed ring', () => {
    const r = measure(geo, 'area', SQUARE);
    if (r.state !== 'ok' || r.mode !== 'area') throw new Error('expected an area');
    const poly = geo.normalise({ type: 'Polygon', coordinates: [[...SQUARE, first]] });
    expect(r.areaM2).toBe(geo.derive(poly).areaM2);
    expect(r.perimeterM).toBe(geo.derive(poly).lengthM);
    expect(r.areaM2).toBeGreaterThan(9_000);
    expect(r.areaM2).toBeLessThan(10_500);
  });

  it('a crossing outline is refused with the core.geo issue, not measured', () => {
    const bow: Position[] = [
      [9, 48],
      [9.001, 48.001],
      [9.001, 48],
      [9, 48.001],
    ];
    const r = measure(geo, 'area', bow);
    expect(r.state).toBe('refused');
    if (r.state === 'refused') expect(r.issues[0]?.issue).toBe('self_intersection');
  });

  it('the overlay is a line for distance and a polygon for area', () => {
    expect(overlayOf('distance', SQUARE)?.type).toBe('LineString');
    expect(overlayOf('area', SQUARE)?.type).toBe('Polygon');
    expect(overlayOf('distance', [[9, 48]])?.type).toBe('Point');
    expect(overlayOf('area', [])).toBeUndefined();
  });

  it('formats in metric units, de and en', () => {
    expect(formatLength('en', 12.34)).toBe('12.3 m');
    expect(formatLength('de', 1234.5)).toBe('1,23 km');
    expect(formatArea('en', 950)).toBe('950 m²');
    expect(formatArea('de', 25_000)).toBe('2,50 ha');
    expect(formatArea('en', 2_500_000)).toBe('2.50 km²');
  });

  it('property: length is symmetric under reversal and never negative, across the WGS84 range', () => {
    const pos = fc.tuple(
      fc.double({ min: -179, max: 179, noNaN: true }),
      fc.double({ min: -85, max: 85, noNaN: true }),
    );
    fc.assert(
      fc.property(fc.array(pos, { minLength: 2, maxLength: 6 }), (pts) => {
        const a = measure(geo, 'distance', pts);
        const b = measure(geo, 'distance', [...pts].reverse());
        if (a.state !== 'ok' || b.state !== 'ok' || a.mode !== 'distance' || b.mode !== 'distance')
          throw new Error('expected distances');
        expect(a.lengthM).toBeGreaterThanOrEqual(0);
        expect(Math.abs(a.lengthM - b.lengthM)).toBeLessThan(1e-6 * (a.lengthM + 1));
      }),
      { numRuns: 100 },
    );
  });
});
