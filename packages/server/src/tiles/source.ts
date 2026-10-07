/**
 * What the proxy fetches for one map layer source (A-033): the upstream URL shape, the host that limits it, and the
 * cache key. The key hashes everything that decides which bytes come back, so a changed source (another URL, another
 * WMS layer) lands in a new cache directory and never serves the old source's tiles.
 */
import { createHash } from 'node:crypto';
import { isSameOriginPath, MAP_PRESETS, type MapLayer } from '@ueberblick/core';
import { canonicalJson } from '@ueberblick/core';

export interface WmsParams {
  readonly layers: string;
  readonly version: string;
  readonly format: string;
  readonly transparent: boolean;
}

/** A source the proxy can serve, resolved from the config. */
export type ProxySource =
  | { readonly kind: 'template'; readonly key: string; readonly template: string }
  | { readonly kind: 'pmtiles'; readonly key: string; readonly url: string }
  | { readonly kind: 'wms'; readonly key: string; readonly url: string; readonly params: WmsParams };

const keyOf = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 32);

/** The proxy source of a layer's source, or `undefined` for a type that is not proxied (`geojson`, an unknown preset). */
export function resolveSource(source: MapLayer['source']): ProxySource | undefined {
  const s = source as {
    type: string;
    url?: string;
    preset?: string;
    layers?: string;
    version?: string;
    format?: string;
    transparent?: boolean;
  };
  if (s.type === 'xyz' && s.url !== undefined) {
    const template = s.url;
    return { kind: 'template', key: keyOf({ type: 'xyz', template }), template };
  }
  if (s.type === 'preset') {
    const template = MAP_PRESETS.entries.find((p) => p.key === s.preset)?.tiles[0];
    return template === undefined
      ? undefined
      : { kind: 'template', key: keyOf({ type: 'xyz', template }), template };
  }
  if (s.type === 'pmtiles' && s.url !== undefined) {
    const url = s.url;
    return { kind: 'pmtiles', key: keyOf({ type: 'pmtiles', url }), url };
  }
  if (s.type === 'wms' && s.url !== undefined && s.layers !== undefined) {
    const url = s.url;
    const params: WmsParams = {
      layers: s.layers,
      version: s.version ?? '1.3.0',
      format: s.format ?? 'image/png',
      transparent: s.transparent ?? true,
    };
    return { kind: 'wms', key: keyOf({ type: 'wms', url, params }), url, params };
  }
  return undefined;
}

/** The upstream URL of one tile of a template source; `{s}` picks a, b or c by tile so the choice is stable. */
export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template
    .replace('{s}', 'abc'[(x + y) % 3] ?? 'a')
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

/** True when the source is a path on this instance (self-hosted): the proxy does not serve it. */
export const isSelfHosted = (source: ProxySource): boolean =>
  isSameOriginPath(source.kind === 'template' ? source.template : source.url);

/** The host a URL's requests are limited under. */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export interface WmsRequest {
  readonly bbox: readonly [number, number, number, number];
  readonly width: number;
  readonly height: number;
  /** `EPSG:3857`-style code the client asks in (`crs` for 1.3.0, `srs` for 1.1.1). */
  readonly crs: string;
}

/**
 * The upstream GetMap URL: the layer's declared parameters plus the four a client may choose (bbox, size, CRS).
 * Anything else in the request never gets here. 1.3.0 names the CRS `crs`, 1.1.1 `srs`; the layer's own query
 * (a capability token on the configured URL) stays and ours win.
 */
export function wmsUrl(source: Extract<ProxySource, { kind: 'wms' }>, req: WmsRequest): string {
  const url = new URL(source.url);
  const q = url.searchParams;
  q.set('service', 'WMS');
  q.set('request', 'GetMap');
  q.set('version', source.params.version);
  q.set('layers', source.params.layers);
  q.set('styles', '');
  q.set('format', source.params.format);
  q.set('transparent', String(source.params.transparent));
  q.set(source.params.version === '1.1.1' ? 'srs' : 'crs', req.crs);
  q.set('bbox', req.bbox.join(','));
  q.set('width', String(req.width));
  q.set('height', String(req.height));
  return url.href;
}

/** The cache name of one WMS request: a hash of the normalised parameters (bbox rounded to 6 decimals). */
export const wmsCacheName = (req: WmsRequest): string =>
  keyOf({ crs: req.crs.toUpperCase(), bbox: req.bbox.map((n) => n.toFixed(6)), w: req.width, h: req.height });
