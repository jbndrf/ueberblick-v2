/**
 * OGC API Features (WP-110, H6) as one Web handler mounted at `/api/p/<project>/ogc/<path>`:
 * landing page, conformance, collections (one per feature type the caller may see), items (bbox, limit, keyset
 * paging, CQL2 filter, crs) and single items; Part 4 writes are runs (`write.ts`). The caller is the project session
 * (`authorizeProject`); rows are clipped by `SyncService.visible` and properties by the compiled permissions.
 * Errors use the envelope of `http/shared` (codes from `HTTP_ERRORS`).
 */
import { acceptLocales, createGeo, type FeatureId, type Geo } from '@ueberblick/core';
import { authorizeProject, DEVICE_KINDS } from '../shared/access';
import type { Handler } from '../shared/contract';
import { errorResponse } from '../shared/errors';
import { SyncUnavailable } from '../../sync';
import type { Ctx, OgcDeps } from './context';
import { collection, collections, conformance, landing, visibleTypes } from './discovery';
import { serializerFor } from './feature';
import { planFilter } from './filter';
import { readOne, readPage } from './items';
import { parseItemsQuery } from './query';
import { coreCql2, coreCrs } from './core-seams';
import { CRS84, type OgcSeams } from './seams';
import { handleWrite } from './write';

export type { OgcDeps } from './context';

export interface OgcHandlers {
  /** `path` is the rest of the route after `/ogc` ('' for the landing page). */
  readonly handle: Handler<{ readonly project: string; readonly path: string }>;
}

const GEOJSON = 'application/geo+json';
const send = (body: unknown, type = 'application/json', extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': type, 'cache-control': 'private, no-store', ...extra },
  });

const ROUTES = {
  landing: ['GET'],
  conformance: ['GET'],
  collections: ['GET'],
  collection: ['GET'],
  items: ['GET', 'POST'],
  item: ['GET', 'PUT', 'PATCH', 'DELETE'],
} as const;

export function createOgcHandlers(deps: OgcDeps): OgcHandlers {
  const geo: Geo = deps.geo ?? createGeo();
  const seams: OgcSeams = { crs: deps.seams?.crs ?? coreCrs, cql2: deps.seams?.cql2 ?? coreCql2 };

  function items(ctx: Ctx, req: Request): Response {
    const url = new URL(req.url);
    const parsed = parseItemsQuery(url.searchParams, seams.crs);
    if (!parsed.ok) return errorResponse('invalid_query', parsed.message);
    const q = parsed.query;
    const key = ctx.caller.project.key;
    let filter;
    if (q.filter !== undefined) {
      const facts = deps.store(key).access(ctx.version);
      if (facts === undefined)
        return errorResponse('conflict', 'The deployed config version is not available.');
      const planned = planFilter(
        { cql2: seams.cql2, config: ctx.config, geo, now: deps.clock.now(), features: facts },
        ctx.type,
        q.filter,
        q.filterLang,
        q.bbox,
      );
      if (!planned.ok) return errorResponse('invalid_query', planned.message);
      filter = planned.plan;
    }
    const result = readPage(deps.db(key), {
      type: ctx.type,
      visible: ctx.visible,
      limit: q.limit,
      ...(deps.residualScanCap === undefined ? {} : { scanCap: deps.residualScanCap }),
      after: q.after,
      ...(q.bbox ? { bbox: q.bbox } : {}),
      ...(filter ? { filter } : {}),
    });
    if (!result.ok) return errorResponse('filter_too_broad', result.message);
    const toFeature = serializerFor(ctx.config, ctx.type, ctx.caller.actor, seams.crs, q.crs);
    const features = result.page.rows.map(toFeature);
    const here = `${ctx.base}/collections/${ctx.type}/items`;
    const at = (cursor?: number): string => {
      const p = new URLSearchParams(url.searchParams);
      p.delete('cursor');
      if (cursor !== undefined) p.set('cursor', String(cursor));
      const s = p.toString();
      return s === '' ? here : `${here}?${s}`;
    };
    const links = [
      { rel: 'self', href: at(q.after === 0 ? undefined : q.after), type: GEOJSON },
      ...(result.page.next === undefined ? [] : [{ rel: 'next', href: at(result.page.next), type: GEOJSON }]),
    ];
    return send(
      {
        type: 'FeatureCollection',
        features,
        numberReturned: features.length,
        timeStamp: deps.clock.now(),
        links,
      },
      GEOJSON,
      { 'content-crs': `<${q.crs}>` },
    );
  }

  function item(ctx: Ctx, id: string): Response {
    const row = readOne(deps.db(ctx.caller.project.key), ctx.type, id, ctx.visible);
    if (row === undefined) return errorResponse('not_found', 'No such feature.');
    const feature = serializerFor(ctx.config, ctx.type, ctx.caller.actor, seams.crs, CRS84)(row);
    const here = `${ctx.base}/collections/${ctx.type}/items/${id}`;
    return send(
      {
        ...feature,
        links: [
          { rel: 'self', href: here, type: GEOJSON },
          { rel: 'collection', href: `${ctx.base}/collections/${ctx.type}`, type: 'application/json' },
        ],
      },
      GEOJSON,
    );
  }

  const handle: OgcHandlers['handle'] = async (req, { params }) => {
    const caller = authorizeProject(deps, req, params.project, DEVICE_KINDS);
    if (caller instanceof Response) return caller;
    const segs = params.path.split('/').filter((s) => s !== '');
    const [a, type, c, id] = segs;
    let route: keyof typeof ROUTES | undefined;
    if (segs.length === 0) route = 'landing';
    else if (a === 'conformance' && segs.length === 1) route = 'conformance';
    else if (a === 'collections' && segs.length === 1) route = 'collections';
    else if (a === 'collections' && segs.length === 2) route = 'collection';
    else if (a === 'collections' && c === 'items' && segs.length === 3) route = 'items';
    else if (a === 'collections' && c === 'items' && segs.length === 4) route = 'item';
    if (route === undefined) return errorResponse('not_found', 'No such route.');
    if (!(ROUTES[route] as readonly string[]).includes(req.method))
      return errorResponse('method_not_allowed', `${req.method} is not allowed here.`);

    const deployed = deps.deployed(caller.project.key);
    if (deployed === undefined) return errorResponse('conflict', 'No config version is deployed yet.');
    const pathname = new URL(req.url).pathname.replace(/\/+$/, '');
    const tail = params.path.replace(/\/+$/, '');
    const base =
      new URL(req.url).origin +
      (tail === '' ? pathname : pathname.slice(0, pathname.length - tail.length - 1));
    let visible;
    try {
      visible = deps.sync(caller.project.key).visible(caller.actor, 'f');
    } catch (e) {
      if (e instanceof SyncUnavailable)
        return errorResponse('conflict', 'No config version is deployed yet.');
      throw e;
    }
    const ctx: Ctx = {
      deps,
      seams,
      geo,
      caller,
      config: deployed.config,
      version: deployed.version,
      base,
      type: type ?? '',
      locales: acceptLocales(req.headers.get('accept-language')),
      visible,
    };

    if (route === 'landing') return landing(ctx);
    if (route === 'conformance') return conformance(ctx);
    if (route === 'collections') return collections(ctx);
    if (!visibleTypes(ctx).includes(ctx.type))
      return req.method !== 'GET' && ctx.config.file.types?.[ctx.type] !== undefined
        ? errorResponse('forbidden', `You may not write ${ctx.type}.`, [
            { path: 'permissions.see', message: 'not_permitted' },
          ])
        : errorResponse('not_found', 'No such collection.');
    if (route === 'collection') return collection(ctx, ctx.type);
    if (req.method !== 'GET') return handleWrite(ctx, req, req.method, id);
    return route === 'items' ? items(ctx, req) : item(ctx, id as FeatureId);
  };

  return { handle };
}
