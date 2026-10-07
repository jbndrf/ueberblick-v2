import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { harnessCacheDir } from '../../../../../../scripts/e2e/component-config.mjs';

const require = createRequire(import.meta.url);
const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'] as const;

/** MapLibre 6 loads its worker from a file beside its main module; serve it from `/maplibre/` (the app does this in its own config). */
function maplibreWorkers(): Plugin {
  return {
    name: 'maplibre-workers',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = FILES.find((f) => req.url?.split('?')[0] === `/maplibre/${f}`);
        if (name === undefined) return next();
        res.setHeader('content-type', 'text/javascript; charset=utf-8');
        res.end(readFileSync(require.resolve(`maplibre-gl/dist/${name}`)));
      });
    },
  };
}

/** The harness page for the draw e2e: the real MapLibre renderer and the real DrawOnMap, no server data. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: harnessCacheDir(import.meta.url),
  plugins: [tailwindcss(), svelte(), maplibreWorkers()],
  server: { fs: { allow: [fileURLToPath(new URL('../../../../../..', import.meta.url))] } },
});
