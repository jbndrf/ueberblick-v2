// Builds the scenario pages with Vite and serves them (gzip, cacheable like a production app).
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { copyFileSync, createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { build } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SCENARIOS = join(ROOT, 'scenarios');
export const DIST = join(ROOT, 'dist');
const REPO = join(ROOT, '..', '..');

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};
const GZIP = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);

/** @param {string[]} pages scenario folder names, each with an index.html */
export async function buildPages(pages) {
  // The ui strings are compiled by Paraglide (generated, git-ignored), like in the test setup.
  execFileSync(
    'npx',
    [
      'paraglide-js',
      'compile',
      '--project',
      './packages/ui/project.inlang',
      '--outdir',
      './packages/ui/src/paraglide',
    ],
    { cwd: REPO, stdio: 'ignore' },
  );
  await build({
    root: SCENARIOS,
    configFile: false,
    base: './',
    logLevel: 'error',
    plugins: [svelte({ compilerOptions: { css: 'injected' } })],
    worker: { format: 'es' },
    build: {
      outDir: DIST,
      emptyOutDir: true,
      target: 'es2022',
      minify: process.env.BENCH_PROFILE_DIR === undefined, // readable function names when profiling
      rollupOptions: { input: Object.fromEntries(pages.map((p) => [p, join(SCENARIOS, p, 'index.html')])) },
    },
  });
  // MapLibre 6 loads its worker from a file next to its main module (import.meta.url). A bundler
  // renames the main chunk, so the worker files must be served beside it. The app build needs the same.
  const dist = join(REPO, 'node_modules', 'maplibre-gl', 'dist');
  for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
    copyFileSync(join(dist, f), join(DIST, 'assets', f));
  }
}

/** Static server for `dist`. Assets are cacheable (a warm start reuses them), HTML is revalidated. */
export async function serve() {
  const server = http.createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    const file = join(DIST, path);
    if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    const ext = extname(file);
    const headers = {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    };
    if (GZIP.has(ext) && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
      const body = gzipSync(readFileSync(file), { level: 6 });
      res.writeHead(200, { ...headers, 'content-encoding': 'gzip', 'content-length': body.length }).end(body);
    } else {
      res.writeHead(200, { ...headers, 'content-length': statSync(file).size });
      createReadStream(file).pipe(res);
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}
