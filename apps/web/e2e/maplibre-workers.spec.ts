import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * WP-165: the build copies MapLibre's worker and shared file next to each other in the client output, and
 * `WORKER_URL` (MapCanvas) points at them. Runs against the real build (`npm run e2e` builds first); no browser.
 */
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const client = resolve(here, '../.svelte-kit/output/client');
const workerUrl = (): string => {
  const src = readFileSync(resolve(here, '../src/lib/participant/shell/MapCanvas.svelte'), 'utf8');
  const m = /const WORKER_URL = `([^`]+)`/.exec(src);
  if (!m) throw new Error('WORKER_URL not found in MapCanvas.svelte');
  const pkg = readFileSync(require.resolve('maplibre-gl/package.json'), 'utf8');
  const version = (JSON.parse(pkg) as { version: string }).version;
  return (m[1] as string).replace('${__MAPLIBRE_VERSION__}', version);
};

test('the build holds both worker files, and WORKER_URL resolves to them', () => {
  const url = workerUrl();
  expect(url).toMatch(/^\/_app\/immutable\/maplibre-gl-\d+\.\d+\.\d+[^/]*\/maplibre-gl-worker\.mjs$/);
  const worker = join(client, url);
  const shared = join(dirname(worker), 'maplibre-gl-shared.mjs');
  expect(existsSync(worker), worker).toBe(true);
  expect(existsSync(shared), shared).toBe(true);
  expect(readFileSync(worker, 'utf8')).toContain('maplibre-gl-shared.mjs');
});

test('the participant-assets route is gone', () => {
  const route = resolve(here, '../src/routes/(participant)/participant-assets');
  expect(existsSync(route)).toBe(false);
});
