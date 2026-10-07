/**
 * Two seams over core (`core-seams.ts` has the real ones): each is one small local interface, so a test or another CRS
 * source can stand in and the handlers stay unchanged.
 *
 * - `Cql2Seam`: `fromCql2` + the check environment of a feature type.
 * - `CrsSeam`: WGS84 to a target CRS (`fromWgs84`).
 */
import type { Bbox, CompiledConfig, Geometry, Json } from '@ueberblick/core';
import type { TypedAst } from '@ueberblick/core/expr/compile';

/** CRS identifiers as OGC API URIs. */
export const CRS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';
export const EPSG_4326 = 'http://www.opengis.net/def/crs/EPSG/0/4326';

export type FilterLang = 'cql2-text' | 'cql2-json';

/** A CQL2 filter read and checked against one feature type (`self` is that type). */
export type CheckedFilter =
  { readonly ok: true; readonly typed: TypedAst } | { readonly ok: false; readonly message: string };

export interface Cql2Seam {
  /** `fromCql2` then `check` against the type's environment; total. */
  read(config: CompiledConfig, type: string, filter: string | object, lang: FilterLang): CheckedFilter;
}

export interface CrsSeam {
  /** The CRS URIs collections advertise, storage CRS first. */
  readonly supported: readonly string[];
  /** Geometry in WGS84 lon/lat to `crs` (a member of `supported`), in the axis order of that CRS. */
  fromWgs84(g: Geometry, crs: string): Geometry;
  /** Geometry in `crs` to WGS84 lon/lat. */
  toWgs84(g: Geometry, crs: string): Geometry;
  /** A bbox given in `crs` (its own axis order) to WGS84 lon/lat. */
  bboxToWgs84(b: Bbox, crs: string): Bbox;
}

export interface OgcSeams {
  readonly cql2: Cql2Seam;
  readonly crs: CrsSeam;
}

/** Swap x and y of every position (EPSG:4326 is lat/lon in OGC API; CRS84 is lon/lat). */
export function swapAxes(g: Geometry): Geometry {
  const pos = (p: readonly number[]): number[] =>
    p.length === 3 ? [p[1] as number, p[0] as number, p[2] as number] : [p[1] as number, p[0] as number];
  const walk = (c: unknown): unknown =>
    Array.isArray(c) && typeof c[0] === 'number' ? pos(c as number[]) : Array.isArray(c) ? c.map(walk) : c;
  const j = g as unknown as { type: string; coordinates?: unknown; geometries?: Geometry[] };
  if (j.type === 'GeometryCollection')
    return { ...j, geometries: (j.geometries ?? []).map(swapAxes) } as unknown as Geometry;
  return { ...j, coordinates: walk(j.coordinates) } as unknown as Geometry;
}

export type JsonObject = { readonly [k: string]: Json };
