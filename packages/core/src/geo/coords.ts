/** Position-level helpers shared by the geo modules. Z is carried through, never dropped (H1). */
import type { Geometry, Position } from './contract';

export type Ring = readonly Position[];

/** Rebuild a geometry with every position replaced by `fn(position)`. Structure and Z-handling are the caller's. */
export function mapPositions(g: Geometry, fn: (p: Position) => Position): Geometry {
  switch (g.type) {
    case 'Point':
      return { type: 'Point', coordinates: fn(g.coordinates) };
    case 'MultiPoint':
      return { type: 'MultiPoint', coordinates: g.coordinates.map(fn) };
    case 'LineString':
      return { type: 'LineString', coordinates: g.coordinates.map(fn) };
    case 'MultiLineString':
      return { type: 'MultiLineString', coordinates: g.coordinates.map((l) => l.map(fn)) };
    case 'Polygon':
      return { type: 'Polygon', coordinates: g.coordinates.map((r) => r.map(fn)) };
    case 'MultiPolygon':
      return { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map((r) => r.map(fn))) };
    case 'GeometryCollection':
      return { type: 'GeometryCollection', geometries: g.geometries.map((m) => mapPositions(m, fn)) };
  }
}

/** Every polygon of a geometry as rings (exterior first), in document order. */
export function polygonsOf(g: Geometry): readonly (readonly Ring[])[] {
  switch (g.type) {
    case 'Polygon':
      return [g.coordinates];
    case 'MultiPolygon':
      return g.coordinates;
    case 'GeometryCollection':
      return g.geometries.flatMap(polygonsOf);
    default:
      return [];
  }
}

/** Every line (open polylines, not rings) of a geometry. */
export function linesOf(g: Geometry): readonly Ring[] {
  switch (g.type) {
    case 'LineString':
      return [g.coordinates];
    case 'MultiLineString':
      return g.coordinates;
    case 'GeometryCollection':
      return g.geometries.flatMap(linesOf);
    default:
      return [];
  }
}

export function pointsOf(g: Geometry): readonly Position[] {
  switch (g.type) {
    case 'Point':
      return [g.coordinates];
    case 'MultiPoint':
      return g.coordinates;
    case 'GeometryCollection':
      return g.geometries.flatMap(pointsOf);
    default:
      return [];
  }
}
export function hasZ(p: Position): p is readonly [number, number, number] {
  return p.length === 3;
}

/** 1e-7 degrees is about 1 cm (docs/09-standards.md). */
const SCALE = 1e7;
export function round7(n: number): number {
  return Math.round(n * SCALE) / SCALE;
}

/** Twice the signed area of a ring in coordinate space: positive means counter-clockwise. */
export function signedArea2(ring: Ring): number {
  let s = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    s += at(ring, i)[0] * at(ring, i + 1)[1] - at(ring, i + 1)[0] * at(ring, i)[1];
  }
  return s;
}

export function firstPosition(g: Geometry): Position | undefined {
  switch (g.type) {
    case 'Point':
      return g.coordinates;
    case 'MultiPoint':
    case 'LineString':
      return g.coordinates[0];
    case 'MultiLineString':
    case 'Polygon':
      return g.coordinates[0]?.[0];
    case 'MultiPolygon':
      return g.coordinates[0]?.[0]?.[0];
    case 'GeometryCollection':
      for (const m of g.geometries) {
        const p = firstPosition(m);
        if (p) return p;
      }
      return undefined;
  }
}

/** Indexed read that fails loudly instead of returning undefined (noUncheckedIndexedAccess without `!`). */
export function at<T>(items: readonly T[], i: number): T {
  const v = items[i];
  if (v === undefined) throw new Error(`index ${i} out of range (length ${items.length})`);
  return v;
}
