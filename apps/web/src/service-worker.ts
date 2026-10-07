/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';
import { factsOf, respond, storableShell } from './service-worker/handler';
import {
  SHELLS,
  WORKER_ASSETS_FILE,
  cacheNameFor,
  precacheList,
  routeFor,
  staleCaches,
} from './service-worker/routing';

declare const self: ServiceWorkerGlobalScope;

// WP-631: the offline cold start. The build, the static files and the page shells are cached at install and served
// cache-first, so a start never waits for the network (v3's NetworkFirst waited up to 10 s). A new build is a new
// worker: it installs its own cache, takes over at once and the page reloads into it (`app.html`). A served shell is
// refetched in the background, so its CSP header (map hosts, WP-957) follows deploys without waiting for a new build.
const CACHE = cacheNameFor(version);
const BASE_ASSETS = precacheList(build, files, []);
const ASSET_PATHS: ReadonlySet<string> = new Set(BASE_ASSETS);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // The worker bundles (sync, photo, map) are not in SvelteKit's `build` list; the build writes them to one file (WP-717).
      const listed = await fetch(new Request(`/${WORKER_ASSETS_FILE}`, { cache: 'reload' }));
      if (!listed.ok) throw new Error(`${WORKER_ASSETS_FILE}: ${listed.status}`);
      const workers = (await listed.json()) as string[];
      await cache.addAll(precacheList(build, files, workers));
      // `reload` bypasses the HTTP cache: a shell must come from this build's server, not an older response.
      await cache.addAll(SHELLS.map((s) => new Request(s, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of staleCaches(await caches.keys(), CACHE)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const navigate = event.request.mode === 'navigate';
  // `respondWith` must be called before any await, so the worker decides first and only then answers.
  if (routeFor(factsOf(event.request, navigate), self.location.origin, ASSET_PATHS).kind === 'network')
    return;
  event.respondWith(
    respond(event.request, navigate, {
      origin: self.location.origin,
      assets: ASSET_PATHS,
      match: async (path) => (await caches.open(CACHE)).match(path),
      fetch: (r) => fetch(r),
      revalidate: (path) =>
        event.waitUntil(
          (async () => {
            // `reload` bypasses the HTTP cache; offline or a failed answer keeps the cached shell.
            const res = await fetch(new Request(path, { cache: 'reload' })).catch(() => undefined);
            if (res && storableShell(res)) await (await caches.open(CACHE)).put(path, res);
          })(),
        ),
    }).then((r) => r ?? fetch(event.request)),
  );
});
