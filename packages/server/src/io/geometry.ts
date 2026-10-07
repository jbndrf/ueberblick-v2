/** The one preparation of a geometry before it is stored: import and migration both use it (R1). */
import type { Geo, GeoSourceCrs, Geometry } from '@ueberblick/core';

const KIND = {
  point: 'Point',
  multipoint: 'MultiPoint',
  linestring: 'LineString',
  multilinestring: 'MultiLineString',
  polygon: 'Polygon',
  multipolygon: 'MultiPolygon',
} as const;

export interface PrepareGeometryOptions {
  readonly sourceCrs: GeoSourceCrs;
  /** The `geometry_type` of the target property; `any` or absent accepts every kind. */
  readonly kind?: string | undefined;
  /** Repair an invalid geometry instead of refusing it. Default `true`: imports repair too. */
  readonly repair?: boolean;
}

export type PreparedGeometry = { readonly geometry: Geometry } | { readonly message: string };

function firstPosition(g: Geometry): readonly number[] | undefined {
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
      return g.geometries.map(firstPosition).find((p) => p !== undefined);
  }
}

/** Reproject to WGS84, normalise, check bounds and kind, validate, and repair unless told not to. */
export function prepareGeometry(geo: Geo, g: Geometry, options: PrepareGeometryOptions): PreparedGeometry {
  const { sourceCrs: crs, kind, repair = true } = options;
  const wgs = geo.normalise(geo.toWgs84(g, crs));
  const first = firstPosition(wgs);
  if (Math.abs(first?.[0] ?? 0) > 180 || Math.abs(first?.[1] ?? 0) > 90)
    return { message: `outside the bounds of ${crs}` };
  const want = kind === undefined || kind === 'any' ? undefined : KIND[kind as keyof typeof KIND];
  if (want !== undefined && wgs.type !== want) return { message: `expected ${want}, found ${wgs.type}` };
  const report = geo.validate(wgs);
  if (report.valid) return { geometry: wgs };
  if (!repair) return { message: `invalid geometry: ${report.issues.map((i) => i.issue).join(', ')}` };
  const fixed = geo.repair(wgs);
  return fixed.ok
    ? { geometry: fixed.geometry }
    : { message: `invalid geometry: ${fixed.issues.map((i) => i.issue).join(', ')}` };
}
