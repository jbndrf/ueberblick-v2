import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGeo } from './index';
import { LINE, PT_INSIDE, PT_OUTSIDE, SQUARE, SQUARE_Z, WITH_HOLE } from './fixtures';
import type { Geometry, Point, Position } from './contract';

const geo = createGeo();
const pt = (lon: number, lat: number): Point => ({ type: 'Point', coordinates: [lon, lat] });

/** Vincenty inverse on WGS84: the reference the 0.5 % claim is measured against (test-only). */
function vincentyM(a: Position, b: Position): number {
  const A = 6378137;
  const F = 1 / 298.257223563;
  const B = A * (1 - F);
  const rad = Math.PI / 180;
  const U1 = Math.atan((1 - F) * Math.tan(a[1] * rad));
  const U2 = Math.atan((1 - F) * Math.tan(b[1] * rad));
  const L = (b[0] - a[0]) * rad;
  let lam = L;
  let sinS = 0;
  let cosS = 0;
  let sig = 0;
  let cos2A = 0;
  let cos2M = 0;
  for (let i = 0; i < 200; i++) {
    const sl = Math.sin(lam);
    const cl = Math.cos(lam);
    sinS = Math.hypot(Math.cos(U2) * sl, Math.cos(U1) * Math.sin(U2) - Math.sin(U1) * Math.cos(U2) * cl);
    if (sinS === 0) return 0;
    cosS = Math.sin(U1) * Math.sin(U2) + Math.cos(U1) * Math.cos(U2) * cl;
    sig = Math.atan2(sinS, cosS);
    const sinA = (Math.cos(U1) * Math.cos(U2) * sl) / sinS;
    cos2A = 1 - sinA * sinA;
    cos2M = cos2A === 0 ? 0 : cosS - (2 * Math.sin(U1) * Math.sin(U2)) / cos2A;
    const C = (F / 16) * cos2A * (4 + F * (4 - 3 * cos2A));
    const prev = lam;
    lam = L + (1 - C) * F * sinA * (sig + C * sinS * (cos2M + C * cosS * (-1 + 2 * cos2M * cos2M)));
    if (Math.abs(lam - prev) < 1e-12) break;
  }
  const u2 = (cos2A * (A * A - B * B)) / (B * B);
  const K1 = (Math.sqrt(1 + u2) - 1) / (Math.sqrt(1 + u2) + 1);
  const K1b = (K1 * K1) / 4;
  const Ac = (1 + K1b) / (1 - K1);
  const Bc = K1 * (1 - (3 * K1b) / 4);
  const ds =
    Bc *
    sinS *
    (cos2M +
      (Bc / 4) *
        (cosS * (-1 + 2 * cos2M * cos2M) -
          (Bc / 6) * cos2M * (-3 + 4 * sinS * sinS) * (-3 + 4 * cos2M * cos2M)));
  return B * Ac * (sig - ds);
}

const near = (got: number, ref: number) => expect(Math.abs(got - ref) / ref).toBeLessThan(0.005);

describe('geo.distanceM', () => {
  it('point to point matches Vincenty for German city pairs', () => {
    const cities: Position[] = [
      [13.405, 52.52], // Berlin
      [9.993, 53.551], // Hamburg
      [11.582, 48.135], // Munich
      [6.96, 50.938], // Cologne
      [8.682, 50.111], // Frankfurt
      [13.737, 51.05], // Dresden
    ];
    for (const a of cities)
      for (const b of cities)
        if (a !== b) near(geo.distanceM(pt(a[0], a[1]), pt(b[0], b[1])), vincentyM(a, b));
  });

  it('point inside a polygon, on a vertex and in the same place is 0', () => {
    expect(geo.distanceM(PT_INSIDE, SQUARE)).toBe(0);
    expect(geo.distanceM(pt(13.4, 52.5), SQUARE)).toBe(0);
    expect(geo.distanceM(PT_OUTSIDE, PT_OUTSIDE)).toBe(0);
  });

  it('point to polygon measures to the nearest edge', () => {
    const maxLon = Math.max(...(SQUARE.coordinates[0] ?? []).map((p) => p[0]));
    near(
      geo.distanceM(pt(maxLon + 0.01, 52.505), SQUARE),
      vincentyM([maxLon, 52.505], [maxLon + 0.01, 52.505]),
    );
  });

  it('a point inside a hole measures to the hole edge', () => {
    near(geo.distanceM(pt(13.405, 52.505), WITH_HOLE), vincentyM([13.405, 52.505], [13.403, 52.505]));
  });

  it('line to polygon: crossing is 0, a parallel line measures the gap', () => {
    expect(geo.distanceM(LINE, SQUARE)).toBeGreaterThanOrEqual(0);
    const crossing: Geometry = {
      type: 'LineString',
      coordinates: [
        [13.39, 52.505],
        [13.42, 52.505],
      ],
    };
    expect(geo.distanceM(crossing, SQUARE)).toBe(0);
    const parallel: Geometry = {
      type: 'LineString',
      coordinates: [
        [13.4, 52.52],
        [13.41, 52.52],
      ],
    };
    near(geo.distanceM(parallel, SQUARE), vincentyM([13.405, 52.52], [13.405, 52.51]));
  });

  it('ignores Z', () => {
    expect(geo.distanceM(PT_OUTSIDE, SQUARE_Z)).toBe(geo.distanceM(PT_OUTSIDE, SQUARE));
    expect(geo.distanceM({ type: 'Point', coordinates: [13, 52, 900] }, pt(13.1, 52))).toBe(
      geo.distanceM(pt(13, 52), pt(13.1, 52)),
    );
  });

  it('throws on an empty geometry', () => {
    expect(() => geo.distanceM({ type: 'MultiPoint', coordinates: [] }, PT_OUTSIDE)).toThrow();
  });

  it('dwithin agrees with distance <= metres, and distance is symmetric (property)', () => {
    const coord = fc.tuple(
      fc.double({ min: 13.3, max: 13.5, noNaN: true }),
      fc.double({ min: 52.4, max: 52.6, noNaN: true }),
    );
    const geom = fc.oneof(
      coord.map(([x, y]): Geometry => pt(x, y)),
      fc.tuple(coord, coord).map(([a, b]): Geometry => ({ type: 'LineString', coordinates: [a, b] })),
      fc.constant<Geometry>(SQUARE),
      fc.constant<Geometry>(WITH_HOLE),
    );
    fc.assert(
      fc.property(geom, geom, fc.double({ min: 0, max: 20000, noNaN: true }), (a, b, m) => {
        expect(geo.dwithin(a, b, m)).toBe(geo.distanceM(a, b) <= m);
        expect(geo.distanceM(a, b)).toBeCloseTo(geo.distanceM(b, a), 6);
      }),
      { numRuns: 200 },
    );
  });
});
