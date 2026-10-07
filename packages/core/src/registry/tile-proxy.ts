/** Admin and server side map tables: the tile proxy limits and policies, and the ready-made WMS sources (not in the registry barrel, WP-815). */
import { defineRegistry, type KeyOf } from './define';

/**
 * Limits of the tile proxy and its cache (A-033, R6). Raising one is a change here, never a per-project setting.
 * Sizes are bytes, times are seconds unless the key says otherwise.
 */
export const TILE_PROXY_LIMITS = defineRegistry([
  {
    key: 'cache_max_bytes',
    description: 'The size cap of the tile cache; the least recently used go first.',
    value: 2_000_000_000,
  },
  {
    key: 'cache_max_age_s',
    description: 'A cached tile older than this is fetched again.',
    value: 30 * 86_400,
  },
  {
    key: 'browser_max_age_s',
    description: 'The `max-age` of a tile response to the browser.',
    value: 86_400,
  },
  { key: 'upstream_concurrency', description: 'Requests in flight at once per upstream host.', value: 2 },
  { key: 'upstream_per_second', description: 'Requests started per second per upstream host.', value: 10 },
  {
    key: 'upstream_retries',
    description: 'Tries after the first one when an upstream fails (5xx, 429, network).',
    value: 3,
  },
  {
    key: 'upstream_retry_base_ms',
    description: 'Wait before the first retry; it doubles each time.',
    value: 500,
  },
  {
    key: 'upstream_retry_after_max_s',
    description: 'The longest `Retry-After` the proxy waits for.',
    value: 30,
  },
  {
    key: 'tile_max_bytes',
    description: 'An upstream answer larger than this is not a tile.',
    value: 4_000_000,
  },
  { key: 'wms_max_pixels', description: 'The largest width or height of a WMS GetMap request.', value: 2048 },
] as const);
export type TileProxyLimit = KeyOf<typeof TILE_PROXY_LIMITS>;

/** The value of one tile proxy limit. */
export function tileProxyLimit(key: TileProxyLimit): number {
  return TILE_PROXY_LIMITS.get(key).value;
}

/** Why the tile proxy refuses to contact an address (A-033, SSRF guard); the refusal is typed, nothing is fetched. */
export const UPSTREAM_REFUSALS = defineRegistry([
  {
    key: 'bad_url',
    description: 'Not an http(s) URL with a host (a protocol-relative `//host` URL is not accepted).',
  },
  {
    key: 'private_address',
    description: 'The host is, or resolves to, a loopback, private, link-local or reserved address.',
  },
  { key: 'own_host', description: 'The host is this instance itself (PUBLIC_URL).' },
  { key: 'unresolved', description: 'The host name does not resolve.' },
  { key: 'too_many_redirects', description: 'The upstream redirected more often than allowed.' },
] as const);
export type UpstreamRefusal = KeyOf<typeof UPSTREAM_REFUSALS>;

/**
 * Upstream hosts with a usage policy. `pack_max_tiles` is the most tiles one (pack, layer) may fetch from that host:
 * the OSM tile usage policy discourages bulk downloads, so a pack of OSM tiles stays a small regional extract.
 * A host matches itself and its subdomains (`a.tile.openstreetmap.org`).
 */
export const TILE_HOST_POLICIES = defineRegistry([
  {
    key: 'osm',
    description: 'OpenStreetMap tile servers (tile usage policy: no bulk downloads).',
    host: 'tile.openstreetmap.org',
    pack_max_tiles: 10_000,
  },
] as const);

/** The most tiles a pack layer may fetch from the host of `url`, or `undefined` when no policy caps it. */
export function tileHostPackCap(url: string): number | undefined {
  const host = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(url)?.[1]?.toLowerCase();
  if (host === undefined) return undefined;
  return TILE_HOST_POLICIES.entries.find((p) => host === p.host || host.endsWith(`.${p.host}`))
    ?.pack_max_tiles;
}

/**
 * Ready-made WMS sources (v3 `PRESET_SOURCES` entries with `sourceType: 'wms'`). Unlike `MAP_PRESETS` a layer made from
 * one is an ordinary `wms` source (the add dialog writes these fields), so it takes the same proxy, pack and CSP path as
 * any other WMS layer: no special case. No commercial imagery presets (owner Q22).
 */
export const MAP_WMS_PRESETS = defineRegistry([
  {
    key: 'nrw_dop',
    description: 'NRW orthophotos (Geobasis NRW, v3 preset nrw-dop).',
    url: 'https://www.wms.nrw.de/geobasis/wms_nw_dop',
    layers: 'nw_dop_rgb',
    version: '1.1.1',
    format: 'image/png',
    transparent: false,
    maxzoom: 20,
    attribution: 'Geobasis NRW',
  },
  {
    key: 'nrw_dtk',
    description: 'NRW topographic map (Geobasis NRW, v3 preset nrw-dtk).',
    url: 'https://www.wms.nrw.de/geobasis/wms_nw_dtk',
    layers: 'nw_dtk_col',
    version: '1.1.1',
    format: 'image/png',
    transparent: false,
    maxzoom: 20,
    attribution: 'Geobasis NRW',
  },
] as const);
export type MapWmsPreset = KeyOf<typeof MAP_WMS_PRESETS>;
