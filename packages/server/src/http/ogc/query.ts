/** Query parameters of the items endpoint, validated once (unknown parameters are a 400, per OGC API Features Core). */
import type { Bbox } from '@ueberblick/core';
import { CRS84, type CrsSeam, type FilterLang } from './seams';

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;

const ALLOWED = new Set([
  'limit',
  'bbox',
  'bbox-crs',
  'crs',
  'filter',
  'filter-lang',
  'filter-crs',
  'cursor',
  'f',
]);

export interface ItemsQuery {
  readonly limit: number;
  /** In WGS84 lon/lat. */
  readonly bbox?: Bbox;
  /** Output CRS; CRS84 when absent. */
  readonly crs: string;
  readonly filter?: string;
  readonly filterLang: FilterLang;
  /** Keyset cursor: the last row id of the previous page. */
  readonly after: number;
}

export type QueryResult =
  { readonly ok: true; readonly query: ItemsQuery } | { readonly ok: false; readonly message: string };

const bad = (message: string): QueryResult => ({ ok: false, message });

export function parseItemsQuery(params: URLSearchParams, crs: CrsSeam): QueryResult {
  for (const k of params.keys()) if (!ALLOWED.has(k)) return bad(`Unknown query parameter '${k}'.`);
  const f = params.get('f');
  if (f !== null && f !== 'json' && f !== 'geojson')
    return bad(`Format '${f}' is not available; use f=json.`);

  let limit = DEFAULT_LIMIT;
  const rawLimit = params.get('limit');
  if (rawLimit !== null) {
    limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
      return bad(`limit must be an integer from 1 to ${MAX_LIMIT}.`);
  }

  let after = 0;
  const rawCursor = params.get('cursor');
  if (rawCursor !== null) {
    if (!/^\d{1,15}$/.test(rawCursor)) return bad('cursor is not a cursor of this API.');
    after = Number(rawCursor);
  }

  const outCrs = params.get('crs') ?? CRS84;
  if (!crs.supported.includes(outCrs))
    return bad(`crs '${outCrs}' is not supported; see the collection's crs list.`);

  let bbox: Bbox | undefined;
  const rawBbox = params.get('bbox');
  if (rawBbox !== null) {
    const parts = rawBbox.split(',');
    const nums = parts.map((p) => (p.trim() === '' ? NaN : Number(p)));
    if ((nums.length !== 4 && nums.length !== 6) || nums.some((n) => !Number.isFinite(n)))
      return bad('bbox is minx,miny,maxx,maxy (or six numbers with elevation).');
    const [a, b, c, d, e] = nums as number[];
    const box: Bbox =
      nums.length === 4
        ? [a as number, b as number, c as number, d as number]
        : [a as number, b as number, d as number, e as number];
    const bboxCrs = params.get('bbox-crs') ?? CRS84;
    if (!crs.supported.includes(bboxCrs)) return bad(`bbox-crs '${bboxCrs}' is not supported.`);
    bbox = crs.bboxToWgs84(box, bboxCrs);
    if (bbox[0] > bbox[2])
      return bad('A bbox that crosses the antimeridian is not supported; send two requests.');
    if (bbox[1] > bbox[3]) return bad('bbox: miny is larger than maxy.');
  } else if (params.has('bbox-crs')) return bad('bbox-crs needs a bbox.');

  const filter = params.get('filter');
  const lang = params.get('filter-lang') ?? 'cql2-text';
  if (lang !== 'cql2-text' && lang !== 'cql2-json')
    return bad(`filter-lang '${lang}' is not supported; use cql2-text or cql2-json.`);
  if (params.has('filter-crs') && filter === null) return bad('filter-crs needs a filter.');
  if (params.has('filter-crs') && params.get('filter-crs') !== CRS84)
    return bad('filter-crs other than CRS84 is not supported.');

  return {
    ok: true,
    query: {
      limit,
      crs: outCrs,
      filterLang: lang,
      after,
      ...(bbox ? { bbox } : {}),
      ...(filter !== null ? { filter } : {}),
    },
  };
}
