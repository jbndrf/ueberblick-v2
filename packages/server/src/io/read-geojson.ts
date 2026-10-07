/** GeoJSON reader (RFC 7946 plus the legacy `crs` member, which is how a file declares a projected CRS). */
import { GEO_SOURCE_CRS, type GeoSourceCrs, type Geometry, type Json, type Position } from '@ueberblick/core';
import type { ImportRow, ReadResult } from './contract';
import { ImportFileError } from './errors';
import { decodeText } from './read-csv';

type Obj = { readonly [k: string]: Json };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const isPosition = (v: unknown): v is Position =>
  Array.isArray(v) &&
  (v.length === 2 || v.length === 3) &&
  v.every((n) => typeof n === 'number' && Number.isFinite(n));
const isLine = (v: unknown): v is Position[] => Array.isArray(v) && v.length >= 1 && v.every(isPosition);
const isRings = (v: unknown): v is Position[][] => Array.isArray(v) && v.length >= 1 && v.every(isLine);

/** A structurally valid geometry, or `undefined`. Validity (self-intersection) is core.geo's business. */
export function asGeometry(v: unknown): Geometry | undefined {
  if (!isObj(v)) return undefined;
  const c = v['coordinates'];
  switch (v['type']) {
    case 'Point':
      return isPosition(c) ? { type: 'Point', coordinates: c } : undefined;
    case 'MultiPoint':
      return isLine(c) ? { type: 'MultiPoint', coordinates: c } : undefined;
    case 'LineString':
      return isLine(c) && c.length >= 2 ? { type: 'LineString', coordinates: c } : undefined;
    case 'MultiLineString':
      return isRings(c) ? { type: 'MultiLineString', coordinates: c } : undefined;
    case 'Polygon':
      return isRings(c) ? { type: 'Polygon', coordinates: c } : undefined;
    case 'MultiPolygon':
      return Array.isArray(c) && c.length >= 1 && c.every(isRings)
        ? { type: 'MultiPolygon', coordinates: c }
        : undefined;
    case 'GeometryCollection': {
      const gs = v['geometries'];
      if (!Array.isArray(gs)) return undefined;
      const parts = gs.map(asGeometry);
      return parts.every((g) => g !== undefined)
        ? { type: 'GeometryCollection', geometries: parts as Geometry[] }
        : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * `urn:ogc:def:crs:EPSG::25832`, `EPSG:25832` and `urn:ogc:def:crs:OGC:1.3:CRS84` (lon/lat WGS84). A file without a
 * `crs` member is WGS84 (RFC 7946); a declared system the platform cannot reproject stays undeclared, so it is refused.
 */
function declaredCrs(root: Obj): GeoSourceCrs | undefined {
  const crs = root['crs'];
  if (crs === undefined || crs === null) return 'EPSG:4326';
  const name = isObj(crs) && isObj(crs['properties']) ? crs['properties']['name'] : undefined;
  if (typeof name !== 'string') return undefined;
  if (/CRS84$/i.test(name)) return 'EPSG:4326';
  const code = /EPSG:{1,2}(\d+)$/i.exec(name);
  const key = code ? `EPSG:${code[1]}` : undefined;
  return key !== undefined && GEO_SOURCE_CRS.has(key) ? key : undefined;
}

export function readGeoJson(data: Uint8Array | string): ReadResult {
  let root: unknown;
  try {
    root = JSON.parse(decodeText(data));
  } catch {
    throw new ImportFileError('the file is not valid JSON');
  }
  if (!isObj(root)) throw new ImportFileError('the file is not a GeoJSON object');
  const items: readonly unknown[] =
    root['type'] === 'FeatureCollection' && Array.isArray(root['features'])
      ? root['features']
      : root['type'] === 'Feature'
        ? [root]
        : asGeometry(root) !== undefined
          ? [{ type: 'Feature', geometry: root, properties: {} }]
          : [];
  if (items.length === 0 && root['type'] !== 'FeatureCollection') {
    throw new ImportFileError('the file is not a GeoJSON FeatureCollection, Feature or geometry');
  }
  const crs = declaredCrs(root);

  const rows = (function* (): Generator<ImportRow> {
    let row = 0;
    for (const item of items) {
      row++;
      if (!isObj(item) || item['type'] !== 'Feature') {
        yield { row, values: {}, problem: { code: 'row_malformed', message: 'not a GeoJSON Feature' } };
        continue;
      }
      const props = isObj(item['properties']) ? item['properties'] : {};
      const raw = item['geometry'];
      if (raw === null || raw === undefined) {
        yield { row, values: props };
        continue;
      }
      const geometry = asGeometry(raw);
      yield geometry
        ? { row, values: props, geometry }
        : { row, values: props, problem: { code: 'geometry_invalid', message: 'the geometry is malformed' } };
    }
  })();
  return crs === undefined ? { rows } : { rows, declaredCrs: crs };
}
