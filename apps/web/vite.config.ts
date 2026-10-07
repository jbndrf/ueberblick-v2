import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sveltekit } from '@sveltejs/kit/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite';
import { workerAssetsPlugin } from './src/service-worker/worker-assets';
import { MAPLIBRE_VERSION, maplibreDefine } from './maplibre-version';

// MapLibre 6 loads its worker from a file beside its main module, and the app build does not emit it. This plugin
// copies the worker and the shared file it imports by name into one folder of the client output (`_app/immutable`,
// which SvelteKit serves with a year of immutable caching) and serves the same URL in dev. `WORKER_URL` in
// `shell/MapCanvas.svelte` points here. The folder name carries the installed version (`__MAPLIBRE_VERSION__`), so an upgrade gets a fresh path.
const require = createRequire(import.meta.url);
const MAPLIBRE_DIR = `_app/immutable/maplibre-gl-${MAPLIBRE_VERSION}`;
const MAPLIBRE_FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'] as const;

function maplibreWorkers(): Plugin {
  const from = (name: string): string => require.resolve(`maplibre-gl/dist/${name}`);
  return {
    name: 'maplibre-workers',
    generateBundle() {
      if (this.environment.config.build.ssr) return;
      for (const name of MAPLIBRE_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `${MAPLIBRE_DIR}/${name}`,
          source: readFileSync(from(name)),
        });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = MAPLIBRE_FILES.find((f) => req.url?.split('?')[0] === `/${MAPLIBRE_DIR}/${f}`);
        if (name === undefined) return next();
        res.setHeader('content-type', 'text/javascript; charset=utf-8');
        res.end(readFileSync(from(name)));
      });
    },
  };
}

// The workspace packages (`@ueberblick/*`) are TypeScript sources with extensionless relative imports. SvelteKit puts
// the ones that Svelte packages depend on into `ssr.external`, and Node's own loader then fails on `./model`: every dev
// route answered 500. The build bundles them. This makes dev load them through Vite too (one rule, not one alias per module).
const WORKSPACE = /^@ueberblick\//;
function workspaceSources(): Plugin {
  return {
    name: 'workspace-sources',
    enforce: 'post',
    config: (user) => {
      // Vite merges what a hook returns (arrays concatenate), so the list is filtered in place.
      const ssr = user.ssr;
      if (ssr !== undefined && Array.isArray(ssr.external))
        ssr.external = ssr.external.filter((n) => !WORKSPACE.test(n));
      return { ssr: { noExternal: [WORKSPACE] } };
    },
  };
}

export const SVELTE_SHIPPING_DEPS = [
  '@lucide/svelte',
  'bits-ui',
  'svelte-sonner',
  'vaul-svelte',
  'mode-watcher',
  'runed',
  'svelte-toolbelt',
];

// adapter-node keeps every entry of package.json `dependencies` external; better-sqlite3 (native, finds its
// .node file with `bindings`) is listed there on purpose, so it stays a runtime import.
export default defineConfig({
  // `npm run dev` (scripts/dev/dev.mjs) sets DEV_HTTPS: https with a self-signed certificate on every LAN address, so a
  // phone gets a secure context (service worker, Web Locks). `npm run dev:http` leaves it out, for desktop GIS clients.
  plugins: [
    ...(process.env['DEV_HTTPS'] === '1' ? [basicSsl()] : []),
    tailwindcss(),
    sveltekit(),
    maplibreWorkers(),
    // the worker bundles (Vite's `workers` folder and MapLibre's) for the service worker's precache (WP-717)
    workerAssetsPlugin(['_app/immutable/workers', MAPLIBRE_DIR]),
    workspaceSources(),
  ],
  // `__UB_MAP_PROBE__`: the e2e read-back seam of the map (packages/ui/src/map/maplibre/probe.ts); only `UB_MAP_PROBE=1` builds (scripts/e2e/run.mjs) have it
  define: { ...maplibreDefine, __UB_MAP_PROBE__: JSON.stringify(process.env['UB_MAP_PROBE'] === '1') },
  // Kit dependencies that ship `.svelte` files must be bundled into the server build: Node cannot import `.svelte`.
  ssr: { noExternal: SVELTE_SHIPPING_DEPS },
  // The dev server serves the whole workspace: a worker loaded by URL from `packages/*` (the map's cluster worker,
  // `?worker_file`) is not in the module graph and was refused with 403, so `npm run dev` drew no markers (2026-10-05).
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd())] } },
});
