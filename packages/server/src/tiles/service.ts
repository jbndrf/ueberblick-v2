/**
 * The tile service (A-033, WP-369): v3's fetch-through tile cache on the v4 map layers. A tile is looked up in the
 * disk cache, else fetched from its upstream (a URL template, a WMS or a PMTiles archive), checked to really be a
 * tile, cached and returned. The browser never talks to the provider (GDPR); the pack builder fetches through the same
 * service, so building a pack warms the cache and the proxy then serves that region without an upstream call.
 *
 * Concurrent requests for one tile share one upstream fetch (single flight), and a failed or missing tile is never
 * cached. Every upstream request goes through the one host limiter.
 */
import { tileProxyLimit } from '@ueberblick/core';
import { TileType } from 'pmtiles';
import { zxyToTileId } from 'pmtiles';
import { decompress, openArchive, type SourceArchive } from '../packs/archive-read';
import type { FetchRange } from '../packs/fetch';
import { createGuard, type Guard, type Lookup } from './guard';
import { createTileCache, type CacheHit, type TileCache } from './cache';
import { createHostLimiter, type HostLimiter } from './limiter';
import { formatOfExt, sniffRaster, TILE_FORMATS, type TileFormat } from './sniff';
import { hostOf, tileUrl, wmsCacheName, wmsUrl, type ProxySource, type WmsRequest } from './source';
import { createUpstream, type Upstream } from './upstream';

export type TileResult =
  | {
      readonly kind: 'ok';
      readonly bytes: Uint8Array;
      readonly contentType: string;
      readonly ext: string;
      readonly etag: string;
      /** Seconds the tile stays fresh; absent when it is not kept (the browser keeps it no longer). */
      readonly freshForS?: number;
      /** True when no upstream call was needed. */
      readonly cached: boolean;
    }
  | { readonly kind: 'notfound' }
  | { readonly kind: 'error'; readonly reason: string };

export interface TileService {
  tile(req: {
    project: string;
    source: Extract<ProxySource, { kind: 'template' | 'pmtiles' }>;
    z: number;
    x: number;
    y: number;
  }): Promise<TileResult>;
  wms(req: {
    project: string;
    source: Extract<ProxySource, { kind: 'wms' }>;
    request: WmsRequest;
  }): Promise<TileResult>;
  /** The shared limiter (the pack builder's range fetches go through it as well). */
  readonly limiter: HostLimiter;
  readonly guard: Guard;
  /** The cache, for the doctor and tests. */
  readonly cache: TileCache;
}

export interface TileServiceDeps {
  /** `<dataDir>/tiles-cache`. */
  readonly root: string;
  /** Test seam: replaces the pinned connection (the guard's checks still run). */
  readonly fetch?: typeof fetch;
  /** The SSRF guard shared with the pack range fetches (default: one built from the options below). */
  readonly guard?: Guard;
  readonly ownHost?: string;
  /** Test seam: the resolver of the default guard. */
  readonly lookup?: Lookup;
  /** Byte ranges of a PMTiles source (the default is plain HTTP, see the runtime). */
  readonly fetchRange: FetchRange;
  readonly userAgent: string;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Test seams; the registry `TILE_PROXY_LIMITS` are the defaults. */
  readonly limits?: { readonly cacheMaxBytes?: number; readonly cacheMaxAgeS?: number };
  readonly limiter?: HostLimiter;
}

const PMTILES_FORMAT: Partial<Record<TileType, string>> = {
  [TileType.Png]: 'png',
  [TileType.Jpeg]: 'jpg',
  [TileType.Webp]: 'webp',
  [TileType.Avif]: 'avif',
  [TileType.Mvt]: 'mvt',
};
const MAX_ARCHIVES = 32;

export function createTileService(deps: TileServiceDeps): TileService {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const limiter =
    deps.limiter ??
    createHostLimiter({
      concurrency: tileProxyLimit('upstream_concurrency'),
      perSecond: tileProxyLimit('upstream_per_second'),
      now,
      sleep,
    });
  const cache = createTileCache({
    root: deps.root,
    now,
    maxBytes: deps.limits?.cacheMaxBytes ?? tileProxyLimit('cache_max_bytes'),
    maxAgeS: deps.limits?.cacheMaxAgeS ?? tileProxyLimit('cache_max_age_s'),
  });
  const seam = deps.fetch;
  const guard =
    deps.guard ??
    createGuard({
      ...(deps.ownHost === undefined ? {} : { ownHost: deps.ownHost }),
      ...(deps.lookup === undefined ? {} : { lookup: deps.lookup }),
      ...(seam === undefined ? {} : { transport: (u: string, i: RequestInit) => seam(u, i) }),
    });
  const upstream: Upstream = createUpstream({
    fetch: guard.fetch,
    limiter,
    userAgent: deps.userAgent,
    sleep,
    now,
  });
  const limitedRange: FetchRange = (url, offset, length) =>
    limiter.run(hostOf(url), () => deps.fetchRange(url, offset, length));
  const archives = new Map<string, Promise<SourceArchive>>();
  const archive = (url: string): Promise<SourceArchive> => {
    let a = archives.get(url);
    if (a === undefined) {
      if (archives.size >= MAX_ARCHIVES) archives.clear();
      const opened = openArchive(limitedRange, url);
      opened.catch(() => archives.delete(url)); // a failed open is tried again next time
      archives.set(url, (a = opened));
    }
    return a;
  };
  /** The extension a source's tiles had last time: tried first, so a hit is one `stat`. */
  const lastExt = new Map<string, string>();
  const inflight = new Map<string, Promise<TileResult>>();

  const hit = (found: CacheHit): TileResult => ({
    kind: 'ok',
    bytes: found.bytes,
    ext: found.ext,
    contentType: formatOfExt(found.ext)?.contentType ?? 'application/octet-stream',
    etag: found.etag,
    freshForS: found.freshForS,
    cached: true,
  });

  const store = async (
    dir: string[],
    name: string,
    sourceKey: string,
    format: TileFormat,
    bytes: Uint8Array,
    ttlS: number,
  ): Promise<TileResult> => {
    lastExt.set(sourceKey, format.ext);
    let etag = '';
    let freshForS = 0;
    try {
      const put = await cache.put(dir, name, format.ext, bytes, ttlS);
      etag = put.etag;
      freshForS = put.freshForS;
    } catch {
      // A full or read-only disk must not fail the request: the tile is served, just not kept.
      etag = `"${bytes.length.toString(36)}-0"`;
    }
    return {
      kind: 'ok',
      bytes,
      ext: format.ext,
      contentType: format.contentType,
      etag,
      freshForS,
      cached: false,
    };
  };

  const exts = (sourceKey: string): string[] => {
    const first = lastExt.get(sourceKey);
    const all = TILE_FORMATS.map((f) => f.ext);
    return first === undefined ? all : [first, ...all.filter((e) => e !== first)];
  };

  /** Single flight: callers for one key wait for the one fetch that is running. */
  const once = (key: string, run: () => Promise<TileResult>): Promise<TileResult> => {
    const running = inflight.get(key);
    if (running !== undefined) return running;
    const p = run().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };

  const fromTemplate = async (
    dir: string[],
    name: string,
    source: Extract<ProxySource, { kind: 'template' }>,
    z: number,
    x: number,
    y: number,
  ): Promise<TileResult> => {
    const r = await upstream(tileUrl(source.template, z, x, y), 'image/*');
    if (r.kind !== 'ok') return r;
    const format = sniffRaster(r.bytes);
    if (format === undefined) return { kind: 'error', reason: 'the upstream answer is not an image tile' };
    return r.store
      ? store(dir, name, source.key, format, r.bytes, r.ttlS ?? Infinity)
      : {
          kind: 'ok',
          bytes: r.bytes,
          ext: format.ext,
          contentType: format.contentType,
          etag: '',
          cached: false,
        };
  };

  const fromArchive = async (
    dir: string[],
    name: string,
    source: Extract<ProxySource, { kind: 'pmtiles' }>,
    z: number,
    x: number,
    y: number,
  ): Promise<TileResult> => {
    try {
      await guard.check(source.url);
      const a = await archive(source.url);
      const loc = await a.locate(zxyToTileId(z, x, y));
      if (loc === undefined) return { kind: 'notfound' };
      const raw = await limitedRange(source.url, loc.offset, loc.length);
      const bytes = decompress(raw, a.header.tileCompression);
      const format = formatOfExt(PMTILES_FORMAT[a.header.tileType] ?? '');
      if (format === undefined)
        return { kind: 'error', reason: 'the archive holds a tile type the proxy does not serve' };
      return await store(dir, name, source.key, format, bytes, Infinity);
    } catch (e) {
      return { kind: 'error', reason: e instanceof Error ? e.message : String(e) };
    }
  };

  return {
    limiter,
    guard,
    cache,
    async tile({ project, source, z, x, y }) {
      const dir = [project, source.key, String(z), String(x)];
      const name = String(y);
      const cached = await cache.find(dir, name, exts(source.key));
      if (cached !== undefined) return hit(cached);
      return once(`${dir.join('/')}/${name}`, () =>
        source.kind === 'template'
          ? fromTemplate(dir, name, source, z, x, y)
          : fromArchive(dir, name, source, z, x, y),
      );
    },
    async wms({ project, source, request }) {
      const dir = [project, source.key, 'wms'];
      const name = wmsCacheName(request);
      const cached = await cache.find(dir, name, exts(source.key));
      if (cached !== undefined) return hit(cached);
      return once(`${dir.join('/')}/${name}`, async () => {
        const r = await upstream(wmsUrl(source, request), 'image/*');
        if (r.kind !== 'ok') return r.kind === 'notfound' ? { kind: 'error', reason: 'HTTP 404' } : r;
        const format = sniffRaster(r.bytes); // an XML exception document is not a map
        if (format === undefined) return { kind: 'error', reason: 'the WMS answer is not an image' };
        return r.store
          ? store(dir, name, source.key, format, r.bytes, r.ttlS ?? Infinity)
          : {
              kind: 'ok',
              bytes: r.bytes,
              ext: format.ext,
              contentType: format.contentType,
              etag: '',
              cached: false,
            };
      });
    },
  };
}
