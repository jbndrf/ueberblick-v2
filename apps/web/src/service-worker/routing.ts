/**
 * Which way the worker answers a request (WP-631). Pure: the worker (`../service-worker.ts`) only wires it to the
 * Cache API. The participant app is client-only (`ssr = false`), so the page HTML of `/map` and `/login` is a shell that
 * starts the app; the device data comes from IndexedDB. The shells and the build are cache-first; data endpoints never
 * touch the cache, because a cached 200 would pass for a live answer.
 */

/** The pages the app starts on. Each is cached at install as its own shell (SvelteKit names the route in the page). */
export const SHELLS: readonly string[] = ['/map', '/login'];
/**
 * The list of worker files the build writes (`worker-assets.ts`). SvelteKit's `$service-worker` `build` list leaves
 * the Web Worker bundles and MapLibre's worker out, so the install reads this file (WP-717).
 */
export const WORKER_ASSETS_FILE = '_app/worker-assets.json';
/** Build output below this folder is hashed and immutable: a cached copy is always the right one (cache-first). */
const IMMUTABLE = '/_app/immutable/';
/** Where a start-page navigation goes when the network fails. */
export const START_REDIRECT = '/map';
/** Prefixes owned by the server: the device sync, auth and the bootstrap decide freshness themselves. */
const NETWORK_ONLY: readonly string[] = ['/api/', '/participant-api/'];

export type Route =
  | { readonly kind: 'network' }
  | { readonly kind: 'shell'; readonly shell: string }
  | { readonly kind: 'asset' }
  | { readonly kind: 'network-or-map' };

export interface RequestFacts {
  readonly url: URL;
  readonly method: string;
  readonly navigate: boolean;
}

/** `network` means the worker does not answer: the browser asks the server and nothing is cached. */
export function routeFor(req: RequestFacts, origin: string, assets: ReadonlySet<string>): Route {
  const { pathname } = req.url;
  if (req.method !== 'GET' || req.url.origin !== origin) return { kind: 'network' };
  if (NETWORK_ONLY.some((p) => pathname.startsWith(p))) return { kind: 'network' };
  if (req.navigate) {
    if (SHELLS.includes(pathname)) return { kind: 'shell', shell: pathname };
    if (pathname === '/') return { kind: 'network-or-map' };
    return { kind: 'network' };
  }
  return assets.has(pathname) || pathname.startsWith(IMMUTABLE) ? { kind: 'asset' } : { kind: 'network' };
}

/**
 * What the install caches: SvelteKit's `build` and `files` plus the worker bundles it leaves out (WP-717, see
 * `worker-assets.ts`). Once each, no source maps.
 */
export const precacheList = (
  build: readonly string[],
  files: readonly string[],
  workers: readonly string[],
): string[] => [...new Set([...build, ...files, ...workers])].filter((p) => !p.endsWith('.map'));

const PREFIX = 'ub-shell-';
/** One cache per build: a new build never mixes its files with the old one's. */
export const cacheNameFor = (buildVersion: string): string => `${PREFIX}${buildVersion}`;

/** The caches of this app that are not the current one (other apps' caches on the origin are left alone). */
export const staleCaches = (names: readonly string[], current: string): string[] =>
  names.filter((n) => n.startsWith(PREFIX) && n !== current);
