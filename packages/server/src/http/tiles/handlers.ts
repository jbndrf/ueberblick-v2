/**
 * `GET /api/p/<project>/tiles/<layer>/<z>/<x>/<y>` and `GET /api/p/<project>/wms/<layer>?bbox=…&width=…&height=…`
 * (A-033, WP-369): the tile proxy. The browser asks this server for the tiles of a map layer, never the provider.
 *
 * - participant or admin session (401 without); the layer must be visible to the caller's roles (`layersForRoles`, the
 *   one audience rule). A layer the caller does not see, an unknown layer, one of another source type, or a tile
 *   outside the pyramid is 404, never 403.
 * - a self-hosted layer (a URL that is a path on this instance, `/…`) is 404 `not_proxied`: nothing to proxy, the map
 *   loads it directly.
 * - an upstream that fails answers 502 and nothing is cached; an upstream 404 is 404.
 * - the answer is `Cache-Control: private, max-age=<browser_max_age_s>` with an ETag (304 on a match).
 * - WMS passes on only `bbox`, `width`, `height` and `crs`/`srs`; every other query parameter is dropped.
 */
import {
  DEFAULT_BASE_LAYER,
  hasBaseLayer,
  layersForRoles,
  tileProxyLimit,
  type MapLayer,
  type TemplateFile,
} from '@ueberblick/core';
import type { TileResult, TileService } from '../../tiles/service';
import { isSelfHosted, resolveSource, type ProxySource, type WmsRequest } from '../../tiles/source';
import type { DeployedConfig } from '../../sync';
import { authorizeProject, DEVICE_KINDS } from '../shared/access';
import type { Handler, ProjectAccessDeps } from '../shared/contract';
import { errorResponse } from '../shared/errors';

export interface TileHandlersDeps extends ProjectAccessDeps {
  deployed(key: string): DeployedConfig | undefined;
  readonly service: TileService;
}

export interface TileHandlers {
  readonly tile: Handler<{
    readonly project: string;
    readonly layer: string;
    readonly z: string;
    readonly x: string;
    readonly y: string;
  }>;
  readonly wms: Handler<{ readonly project: string; readonly layer: string }>;
}

const notFound = (): Response => errorResponse('not_found', 'No such map layer or tile.');
const INT = /^\d{1,9}$/;
/** `{y}` may carry the format (`12.png`) so a GIS client can use the URL as it is. */
const COORD = /^(\d{1,9})(?:\.(?:png|jpe?g|webp|avif|gif|pbf|mvt))?$/;
const CRS = /^EPSG:\d{4,6}$/i;
const MAX_COORD = 4e7;

const matches = (header: string | null, etag: string): boolean =>
  header !== null &&
  (header.trim() === '*' || header.split(',').some((t) => t.trim().replace(/^W\//, '') === etag));

function answer(req: Request, r: TileResult): Response {
  if (r.kind === 'notfound') return notFound();
  if (r.kind === 'error')
    return errorResponse('upstream_failed', 'The tile source did not answer. Try again later.');
  const headers: Record<string, string> = {
    'content-type': r.contentType,
    'cache-control': `private, max-age=${Math.min(tileProxyLimit('browser_max_age_s'), Math.floor(r.freshForS ?? 0))}`,
    vary: 'Cookie',
    'x-tile-cache': r.cached ? 'HIT' : 'MISS',
  };
  if (r.etag !== '') {
    headers['etag'] = r.etag;
    if (matches(req.headers.get('if-none-match'), r.etag))
      return new Response(null, { status: 304, headers });
  }
  headers['content-length'] = String(r.bytes.length);
  return new Response(r.bytes as Uint8Array<ArrayBuffer>, { status: 200, headers });
}

/** The layer's source when the caller sees the layer, else a 404 response. */
function visibleSource(
  deps: TileHandlersDeps,
  key: string,
  roles: readonly string[],
  layer: string,
): ProxySource | Response {
  const file: TemplateFile | undefined = deps.deployed(key)?.config.file;
  const visible = file?.map === undefined ? undefined : layersForRoles(file.map, roles);
  const found = visible?.layers[layer];
  // The reserved default base: only for a caller who sees no base layer, as the client draws it (WP-712).
  const source =
    found !== undefined
      ? resolveSource(found.source)
      : layer === DEFAULT_BASE_LAYER.key && !(visible !== undefined && hasBaseLayer(visible))
        ? resolveSource({ type: 'preset', preset: DEFAULT_BASE_LAYER.preset } as MapLayer['source'])
        : undefined;
  if (source !== undefined && isSelfHosted(source))
    return errorResponse('not_proxied', 'This layer is hosted on this server; the map loads it directly.');
  return source ?? notFound();
}

/** The four numbers, the size and the CRS of a GetMap request, or `undefined` when one is missing or out of range. */
function parseWms(q: URLSearchParams): WmsRequest | undefined {
  const bbox = (q.get('bbox') ?? '').split(',').map((s) => (s.trim() === '' ? NaN : Number(s)));
  const [w, h] = [q.get('width') ?? '', q.get('height') ?? ''];
  const crs = q.get('crs') ?? q.get('srs') ?? 'EPSG:3857';
  const max = tileProxyLimit('wms_max_pixels');
  if (bbox.length !== 4 || !bbox.every((n) => Number.isFinite(n) && Math.abs(n) <= MAX_COORD))
    return undefined;
  if (!INT.test(w) || !INT.test(h) || Number(w) < 1 || Number(h) < 1 || Number(w) > max || Number(h) > max)
    return undefined;
  if (!CRS.test(crs)) return undefined;
  return {
    bbox: bbox as unknown as WmsRequest['bbox'],
    width: Number(w),
    height: Number(h),
    crs: crs.toUpperCase(),
  };
}

export function createTileHandlers(deps: TileHandlersDeps): TileHandlers {
  const tile: TileHandlers['tile'] = async (req, ctx) => {
    const caller = authorizeProject(deps, req, ctx.params.project, DEVICE_KINDS);
    if (caller instanceof Response) return caller;
    const source = visibleSource(deps, caller.project.key, caller.actor.roles, ctx.params.layer);
    if (source instanceof Response) return source;
    if (source.kind === 'wms') return notFound();
    const { z, x } = ctx.params;
    const y = COORD.exec(ctx.params.y)?.[1];
    if (!INT.test(z) || !INT.test(x) || y === undefined) return notFound();
    const [zn, xn, yn] = [Number(z), Number(x), Number(y)];
    // The pyramid: zoom 0 to 24, columns and rows below 2^zoom.
    if (zn > 24 || xn >= 2 ** zn || yn >= 2 ** zn) return notFound();
    return answer(req, await deps.service.tile({ project: caller.project.key, source, z: zn, x: xn, y: yn }));
  };

  const wms: TileHandlers['wms'] = async (req, ctx) => {
    const caller = authorizeProject(deps, req, ctx.params.project, DEVICE_KINDS);
    if (caller instanceof Response) return caller;
    const source = visibleSource(deps, caller.project.key, caller.actor.roles, ctx.params.layer);
    if (source instanceof Response) return source;
    if (source.kind !== 'wms') return notFound();
    const request = parseWms(new URL(req.url).searchParams);
    if (request === undefined)
      return errorResponse('invalid_query', 'bbox, width, height and crs are needed and must be in range.');
    return answer(req, await deps.service.wms({ project: caller.project.key, source, request }));
  };

  return { tile, wms };
}
