import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { originEnv } from '../../scripts/tls/origin.mjs';

/** `npm run e2e` (scripts/e2e/run.mjs) sets E2E_PORT and E2E_DATA_DIR per run; the fallbacks serve a single direct run only. */
export const E2E_PORT = Number(process.env['E2E_PORT'] ?? 4173);
/** JSON report that `npm run e2e:triage` reads (relative to apps/web). */
export const E2E_REPORT = 'test-results/e2e-report.json';
export const E2E_DATA_DIR = process.env['E2E_DATA_DIR'] ?? join(tmpdir(), 'ueberblick-e2e-flow');

// The main process runs this file before the workers; workers must not wipe the data directory.
if (process.env['TEST_WORKER_INDEX'] === undefined) rmSync(E2E_DATA_DIR, { recursive: true, force: true });

/** e2e runs against the real built process (`npm run build -w @ueberblick/web` first). */
export default defineConfig({
  testDir: 'e2e',
  // Journey candidates only run once adopted (WP-902): they have their own config and `npm run journeys`.
  testIgnore: 'candidates/**',
  fullyParallel: false,
  workers: 1,
  outputDir: 'test-results/artifacts',
  reporter: [['list'], ['json', { outputFile: E2E_REPORT }]],
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node build/index.js',
    url: `http://localhost:${E2E_PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(E2E_PORT),
      HOST: 'localhost',
      PUBLIC_URL: `http://localhost:${E2E_PORT}`,
      // adapter-node's ORIGIN, derived from PUBLIC_URL the way the container entrypoint does it (WP-954)
      ...originEnv({ PUBLIC_URL: `http://localhost:${E2E_PORT}` }),
      DATA_DIR: E2E_DATA_DIR,
      UEBERBLICK_INSECURE_COOKIES: '1',
      TIMERS_INTERVAL_S: '1',
    },
  },
});
