import { MAP_SOURCE_TYPES } from '../registry';

/** What `mapOrigins` reads of a project's map config (`MapConfig` of `schema/map.ts` fits it). */
export interface MapOriginsLike {
  readonly layers: Readonly<Record<string, { readonly source: { readonly type: string } }>>;
}

/** A bare host: letters, digits, dots and hyphens. Refuses `*`, `[`, spaces, quotes and `;`, so no URL widens a policy. */
const HOST = /^[a-z0-9.-]+$/;
const SUBDOMAIN_PLACEHOLDER = '{s}.';

/**
 * The CSP origin of one URL, or the origins when the host starts with `{s}.` (XYZ subdomain templates: the apex and the
 * `*.` wildcard, because the layer lists no subdomains). Relative and protocol-relative URLs fetch from this server and
 * give nothing. Only `https:` is accepted; `http:` only for `localhost` (dev tile servers).
 */
function originsOf(url: unknown): string[] {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return [];
  const sub = url.slice(url.indexOf('//') + 2).startsWith(SUBDOMAIN_PLACEHOLDER);
  const plain = sub ? url.replace(SUBDOMAIN_PLACEHOLDER, '') : url;
  let parsed: URL;
  try {
    parsed = new URL(plain.replace(/\{[a-z]+\}/gi, 'x'));
  } catch {
    return [];
  }
  if (parsed.username !== '' || parsed.password !== '' || !HOST.test(parsed.hostname)) return [];
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === 'localhost'))
    return [];
  if (!sub) return [parsed.origin];
  return [parsed.origin, `${parsed.protocol}//*.${parsed.host}`];
}

/**
 * The sorted, de-duplicated origins (`scheme://host[:port]`) a project's map config fetches from directly. Layers the
 * server's tile proxy serves (`xyz`, `wms`, `preset`, `pmtiles`, raster or vector) give none: the browser asks this
 * server, never the provider (GDPR; A-033), so the policy needs no entry for them. Remote `geojson` (and any other
 * kind) keeps its `source.url` origin. The server adds the result to the `connect-src` and `img-src` of its
 * Content-Security-Policy; nothing else leaves this function, so a config cannot widen the policy with keywords, `*`,
 * `data:` or `javascript:`. O(layers).
 */
export function mapOrigins(map: MapOriginsLike): string[] {
  const out = new Set<string>();
  for (const { source } of Object.values(map.layers)) {
    const s = source as { type: string; url?: unknown };
    if (MAP_SOURCE_TYPES.has(s.type) && MAP_SOURCE_TYPES.get(s.type).proxied) continue;
    for (const o of originsOf(s.url)) out.add(o);
  }
  return [...out].sort();
}
