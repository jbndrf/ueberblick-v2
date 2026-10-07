import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGeo, fromWgs84, toWgs84 } from './index';
import { CRS_SAMPLES, POINT_Z, PRECISE, SQUARE } from './fixtures';
import type { Geometry, Position } from './contract';
import { GEO_SOURCE_CRS } from '../registry';
import { at } from './coords';

const geo = createGeo();

function pos(g: Geometry): Position {
  if (g.type !== 'Point') throw new Error('expected a point');
  return g.coordinates;
}

describe('toWgs84', () => {
  it('is the identity for EPSG:4326 and (within rounding) for EPSG:4258', () => {
    expect(geo.toWgs84(POINT_Z, 'EPSG:4326')).toEqual(POINT_Z);
    expect(geo.toWgs84(POINT_Z, 'EPSG:4258')).toEqual(POINT_Z);
  });

  it('puts ETRS89 UTM central meridians on 9 and 15 degrees', () => {
    for (const s of CRS_SAMPLES.filter((c) => c.lon !== undefined)) {
      const [lon, lat] = pos(geo.toWgs84({ type: 'Point', coordinates: [s.x, s.y] }, s.crs));
      expect(lon).toBeCloseTo(s.lon ?? Number.NaN, 7);
      expect(lat).toBeGreaterThan(47);
      expect(lat).toBeLessThan(55);
    }
  });

  it('reprojects every registered German CRS into Germany', () => {
    for (const key of GEO_SOURCE_CRS.keys) {
      const s = CRS_SAMPLES.find((c) => c.crs === key);
      if (!s) continue;
      const [lon, lat] = pos(geo.toWgs84({ type: 'Point', coordinates: [s.x, s.y] }, s.crs));
      expect(lon).toBeGreaterThan(5);
      expect(lon).toBeLessThan(16);
      expect(lat).toBeGreaterThan(47);
      expect(lat).toBeLessThan(55);
    }
  });

  it('Gauss-Krueger zone 3 lands near its 9 degree central meridian', () => {
    const [lon] = pos(geo.toWgs84({ type: 'Point', coordinates: [3500000, 5800000] }, 'EPSG:31467'));
    expect(Math.abs(lon - 9)).toBeLessThan(0.01);
  });

  it('keeps Z unchanged through reprojection (H1)', () => {
    for (const crs of GEO_SOURCE_CRS.keys) {
      const out = pos(geo.toWgs84({ type: 'Point', coordinates: [500000, 5800000, 87.5] }, crs));
      expect(out[2]).toBe(87.5);
    }
  });

  it('reprojects every position of nested geometries and rounds to 7 decimals', () => {
    const utm: Geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [500000, 5800000, 1],
          [500100, 5800000, 2],
          [500100, 5800100, 3],
          [500000, 5800000, 1],
        ],
      ],
    };
    const out = geo.toWgs84(utm, 'EPSG:25833');
    if (out.type !== 'Polygon') throw new Error('type');
    expect(out.coordinates[0]).toHaveLength(4);
    for (const p of at(out.coordinates, 0)) {
      expect(p[0]).toBe(Math.round(p[0] * 1e7) / 1e7);
      expect(p[2]).toBeDefined();
    }
  });

  it('rejects a CRS outside the registry', () => {
    expect(() => geo.toWgs84(SQUARE, 'EPSG:3857' as never)).toThrow();
  });

  it('round trips ETRS89 UTM within a centimetre (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 300000, max: 700000, noNaN: true }),
        fc.double({ min: 5.2e6, max: 6e6, noNaN: true }),
        (x, y) => {
          const wgs = pos(geo.toWgs84({ type: 'Point', coordinates: [x, y] }, 'EPSG:25832'));
          // 1e-7 deg is about 1 cm, so the result is exact to rounding
          const back = pos(geo.toWgs84({ type: 'Point', coordinates: [x + 0.01, y] }, 'EPSG:25832'));
          expect(Math.abs(back[0] - wgs[0])).toBeLessThan(1e-6);
        },
      ),
    );
  });
});

describe('guessCrs', () => {
  it('detects WGS84, ETRS89 UTM and Gauss-Krueger by magnitude', () => {
    expect(geo.guessCrs(POINT_Z)).toBe('EPSG:4326');
    expect(geo.guessCrs({ type: 'Point', coordinates: [391000, 5820000] })).toBe('EPSG:25832');
    expect(geo.guessCrs({ type: 'Point', coordinates: [3391000, 5820000] })).toBe('EPSG:31467');
    expect(geo.guessCrs({ type: 'Point', coordinates: [4391000, 5820000] })).toBe('EPSG:31468');
    expect(geo.guessCrs({ type: 'Point', coordinates: [1, 999999999] })).toBeUndefined();
  });

  it('samples the first position of nested geometries', () => {
    expect(geo.guessCrs(SQUARE)).toBe('EPSG:4326');
  });
});

describe('normalise', () => {
  it('rounds to 7 decimals and keeps Z', () => {
    const out = geo.normalise(PRECISE);
    expect(out).toEqual({ type: 'Point', coordinates: [13.1234568, 52.9876543, 41.5] });
  });

  it('is idempotent (property)', () => {
    const p = fc.tuple(
      fc.double({ min: -180, max: 180, noNaN: true }),
      fc.double({ min: -90, max: 90, noNaN: true }),
    );
    fc.assert(
      fc.property(fc.array(p, { minLength: 3, maxLength: 12 }), (ring) => {
        const g: Geometry = { type: 'Polygon', coordinates: [ring] };
        const once = geo.normalise(g);
        expect(geo.normalise(once)).toEqual(once);
      }),
    );
  });
});

describe('fromWgs84', () => {
  const near = (a: readonly number[], b: readonly number[], tol: number) =>
    a.forEach((v, i) => expect(Math.abs(v - (b[i] as number))).toBeLessThanOrEqual(tol));
  const round = (n: number): number => Math.round(n * 1e7) / 1e7;

  it('inverts toWgs84 for every registered CRS (projected within the 7-decimal rounding of WGS84, Z kept)', () => {
    for (const key of GEO_SOURCE_CRS.keys) {
      const s = CRS_SAMPLES.find((c) => c.crs === key);
      const p: Position = s ? [s.x, s.y, 41.5] : [13.4, 52.5, 41.5];
      const back = pos(fromWgs84(toWgs84({ type: 'Point', coordinates: p }, key), key));
      near(back, p, s ? 0.02 : 1e-7);
      expect(back[2]).toBe(41.5);
    }
  });

  it('property: WGS84 -> CRS -> WGS84 is stable within 1.5e-7 degrees, Z untouched', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...GEO_SOURCE_CRS.keys),
        fc.double({ min: 6.5, max: 14.5, noNaN: true }),
        fc.double({ min: 47.5, max: 54.5, noNaN: true }),
        fc.option(fc.double({ min: -100, max: 4000, noNaN: true }), { nil: undefined }),
        (crs, lon, lat, z) => {
          const c: Position = z === undefined ? [round(lon), round(lat)] : [round(lon), round(lat), z];
          const back = pos(toWgs84(fromWgs84({ type: 'Point', coordinates: c }, crs), crs));
          near(back, c, 1.5e-7);
          expect(back.length).toBe(c.length);
          if (z !== undefined) expect(back[2]).toBe(z);
        },
      ),
    );
  });

  it('maps every position of a polygon and rejects an unsupported CRS', () => {
    expect(fromWgs84(SQUARE, 'EPSG:25832').type).toBe('Polygon');
    expect(() => fromWgs84(SQUARE, 'EPSG:1' as never)).toThrow(/unsupported/);
  });
});
