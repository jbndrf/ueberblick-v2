/** Seeded data for the geo benchmarks (docs/12-performance-budgets.md). Never committed as files. */
import type { Geometry, Point, Polygon } from '../../packages/core/src/geo/contract';

/** mulberry32: small, fast, seeded. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ORIGIN = { lon: 13.2, lat: 52.4 };
const CELL = 0.01;

/** `cols` x `rows` irregular 12-gons, one per grid cell, so none overlap. */
export function areas(cols: number, rows: number, seed = 1): [number, Polygon][] {
  const r = rng(seed);
  const out: [number, Polygon][] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = ORIGIN.lon + (col + 0.5) * CELL;
      const cy = ORIGIN.lat + (row + 0.5) * CELL * 0.6;
      const ring: [number, number][] = [];
      for (let i = 0; i < 12; i++) {
        const a = (2 * Math.PI * i) / 12;
        const rad = 0.3 + 0.2 * r();
        ring.push([cx + rad * CELL * Math.cos(a), cy + rad * CELL * 0.6 * Math.sin(a)]);
      }
      ring.push([...(ring[0] ?? [0, 0])] as [number, number]);
      out.push([row * cols + col, { type: 'Polygon', coordinates: [ring] }]);
    }
  }
  return out;
}

export function points(n: number, cols: number, rows: number, seed = 2): Point[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({
    type: 'Point' as const,
    coordinates: [
      ORIGIN.lon + r() * cols * CELL,
      ORIGIN.lat + r() * rows * CELL * 0.6,
      30 + r() * 20,
    ] as const,
  }));
}

export const asGeometries = (ps: Point[]): Geometry[] => ps;
