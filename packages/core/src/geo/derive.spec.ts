import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGeo } from './index';
import { ALL_VALID, C_SHAPE, LINE, MULTI, POINT_Z, PT_INSIDE, SQUARE, SQUARE_Z, WITH_HOLE } from './fixtures';
import type { Geometry, Polygon } from './contract';
import { at } from './coords';

const geo = createGeo();

describe('derive', () => {
  it('a point derives to itself, keeping Z', () => {
    const d = geo.derive(POINT_Z);
    expect(d.bbox).toEqual([13.405, 52.505, 13.405, 52.505]);
    expect(d.pointOnSurface).toEqual(POINT_Z);
    expect(d.centroid).toEqual(POINT_Z);
    expect(d.areaM2).toBe(0);
    expect(d.lengthM).toBe(0);
  });

  it('bbox of a multipolygon covers all members', () => {
    expect(geo.derive(MULTI).bbox).toEqual([13.4, 52.5, 13.51, 52.51]);
  });

  it('geodesic area of a 0.01 x 0.01 degree cell at 52.5N is about 0.68 km2', () => {
    // 0.01 deg lon = 677.5 m at 52.5N, 0.01 deg lat = 111.27 km / 100 = 1112.7 m
    const a = geo.derive(SQUARE).areaM2;
    expect(a).toBeGreaterThan(0.75e6 * 0.99);
    expect(a).toBeLessThan(0.76e6 * 1.01);
  });

  it('a 1 x 1 degree cell at the equator is about 12,300 km2', () => {
    const cell: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    };
    const km2 = geo.derive(cell).areaM2 / 1e6;
    expect(km2).toBeGreaterThan(12300);
    expect(km2).toBeLessThan(12320);
  });

  it('subtracts holes from the area and adds them to the perimeter', () => {
    const solid = geo.derive(SQUARE);
    const holed = geo.derive(WITH_HOLE);
    expect(holed.areaM2).toBeLessThan(solid.areaM2);
    expect(holed.lengthM).toBeGreaterThan(solid.lengthM);
  });

  it('length of a line is geodesic metres', () => {
    // 0.01 deg lon at 52.5N (~678 m) plus 0.01 deg lat (~1112 m)
    expect(geo.derive(LINE).lengthM).toBeGreaterThan(1780);
    expect(geo.derive(LINE).lengthM).toBeLessThan(1800);
    expect(geo.derive(LINE).areaM2).toBe(0);
  });

  it('centroid is area-weighted and may lie outside; point on surface never does', () => {
    const d = geo.derive(C_SHAPE);
    expect(geo.test('intersects', d.pointOnSurface, C_SHAPE)).toBe(true);
    expect(geo.test('intersects', d.centroid, C_SHAPE)).toBe(false);
  });

  it('centroid of a polygon with a hole is pushed away from the hole', () => {
    const off: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0.02, 0],
          [0.02, 0.02],
          [0, 0.02],
          [0, 0],
        ],
        [
          [0.001, 0.001],
          [0.001, 0.009],
          [0.009, 0.009],
          [0.009, 0.001],
          [0.001, 0.001],
        ],
      ],
    };
    const c = geo.derive(off).centroid.coordinates;
    expect(c[0]).toBeGreaterThan(0.01);
    expect(c[1]).toBeGreaterThan(0.01);
  });

  it('derives every valid fixture without throwing', () => {
    for (const [, g] of ALL_VALID) {
      const d = geo.derive(g);
      expect(d.bbox[0]).toBeLessThanOrEqual(d.bbox[2]);
      expect(d.areaM2).toBeGreaterThanOrEqual(0);
    }
  });

  it('throws on an empty geometry', () => {
    expect(() => geo.derive({ type: 'LineString', coordinates: [] })).toThrow();
  });
});

describe('Z survives reprojection and derivation (H1)', () => {
  it('derivation ignores Z for area and length', () => {
    const flat = geo.derive(SQUARE);
    const tall = geo.derive(SQUARE_Z);
    expect(tall.areaM2).toBeCloseTo(flat.areaM2, 6);
    expect(tall.lengthM).toBeCloseTo(flat.lengthM, 6);
    expect(tall.bbox).toEqual(flat.bbox);
  });

  it('a Point keeps its Z in every derived point; other geometries carry none', () => {
    expect(geo.derive(POINT_Z).pointOnSurface.coordinates[2]).toBe(34.25);
    expect(geo.derive(POINT_Z).centroid.coordinates[2]).toBe(34.25);
    expect(geo.derive(SQUARE_Z).pointOnSurface.coordinates).toHaveLength(2);
  });

  it('normalise and toWgs84 keep the Z of every vertex', () => {
    const out = geo.normalise(geo.toWgs84(SQUARE_Z, 'EPSG:4326'));
    if (out.type !== 'Polygon') throw new Error('type');
    expect(at(out.coordinates, 0).map((p) => p[2])).toEqual([30, 31, 32, 33, 34]);
  });
});

describe('point on surface (property)', () => {
  const rect = fc
    .tuple(
      fc.double({ min: 5, max: 15, noNaN: true }),
      fc.double({ min: 47, max: 55, noNaN: true }),
      fc.double({ min: 1e-4, max: 0.5, noNaN: true }),
      fc.double({ min: 1e-4, max: 0.5, noNaN: true }),
    )
    .map(([x, y, w, h]): Geometry => ({
      type: 'Polygon',
      coordinates: [
        [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
          [x, y],
        ],
      ],
    }));

  it('lies inside rectangles, including thin ones', () => {
    fc.assert(
      fc.property(rect, (g) => {
        const p = geo.derive(g).pointOnSurface;
        expect(geo.test('intersects', p, g)).toBe(true);
        expect(geo.test('within', p, g)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('lies inside random star-shaped polygons and their holed variants', () => {
    const star = fc
      .tuple(
        fc.array(fc.double({ min: 0.2, max: 1, noNaN: true }), { minLength: 5, maxLength: 24 }),
        fc.double({ min: 0.001, max: 0.05, noNaN: true }),
      )
      .map(([radii, scale]): Geometry => {
        const ring = radii.map((r, i) => {
          const a = (2 * Math.PI * i) / radii.length;
          return [13 + r * scale * Math.cos(a), 52 + r * scale * Math.sin(a)] as const;
        });
        return { type: 'Polygon', coordinates: [[...ring, at(ring, 0)]] };
      });
    fc.assert(
      fc.property(star, (g) => {
        const p = geo.derive(g).pointOnSurface;
        expect(geo.test('intersects', p, g)).toBe(true);
      }),
      { numRuns: 200 },
    );
    for (const g of [WITH_HOLE, C_SHAPE, MULTI, PT_INSIDE]) {
      expect(geo.test('intersects', geo.derive(g).pointOnSurface, g)).toBe(true);
    }
  });
});
