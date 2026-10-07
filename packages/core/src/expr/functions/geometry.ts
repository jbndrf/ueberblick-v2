/**
 * Geometry values in expressions: GeoJSON-shaped maps (from properties, from `fromCql2`, or written as
 * literals) are checked structurally, then handed to core.geo, which owns every predicate and measure.
 */
import { GEO_GEOMETRY_TYPES } from '../../registry';
import type { Geometry } from '../../geo/contract';
import type { EvalValue } from '../contract';
import { fail, isMap } from './support';

const isPosition = (p: unknown): boolean =>
  Array.isArray(p) &&
  (p.length === 2 || p.length === 3) &&
  p.every((n) => typeof n === 'number' && Number.isFinite(n));

const isDepth = (c: unknown, depth: number): boolean =>
  depth === 0 ? isPosition(c) : Array.isArray(c) && c.every((x) => isDepth(x, depth - 1));

const COORDINATE_DEPTH: Readonly<Record<string, number>> = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
};
const MAX_COLLECTION_DEPTH = 4;

function isGeometry(v: unknown, depth = 0): boolean {
  if (!isMap(v) || typeof v['type'] !== 'string' || !GEO_GEOMETRY_TYPES.has(v['type'])) return false;
  if (v['type'] === 'GeometryCollection') {
    const parts = v['geometries'];
    return (
      depth < MAX_COLLECTION_DEPTH && Array.isArray(parts) && parts.every((g) => isGeometry(g, depth + 1))
    );
  }
  return isDepth(v['coordinates'], COORDINATE_DEPTH[v['type']] as number);
}

/** The value as a geometry, or a fault. Z passes through untouched (H1). */
export function asGeometry(v: EvalValue | undefined): Geometry {
  if (!isGeometry(v)) return fail('not a geometry: expected a GeoJSON geometry');
  return v as unknown as Geometry;
}

/** Runs a core.geo call and turns an engine exception on odd input into a fault. */
export function withGeo<T>(what: string, run: () => T): T {
  try {
    return run();
  } catch {
    return fail(`cannot ${what} this geometry`);
  }
}
