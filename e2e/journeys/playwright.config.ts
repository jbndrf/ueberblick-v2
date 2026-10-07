import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { phoneAndDesktop } from '../../scripts/e2e/component-config.mjs';

// `npm run e2e` sets E2E_JOURNEYS_PORT and E2E_JOURNEYS_DATA_DIR per run; the fallbacks serve a single direct run only.
export const JOURNEYS_PORT = Number(process.env['E2E_JOURNEYS_PORT'] ?? 4176);
export const JOURNEYS_DATA_DIR =
  process.env['E2E_JOURNEYS_DATA_DIR'] ?? join(tmpdir(), 'ueberblick-e2e-journeys');

if (process.env['TEST_WORKER_INDEX'] === undefined)
  rmSync(JOURNEYS_DATA_DIR, { recursive: true, force: true });

/**
 * The v3 journeys (WP-945): the owner's v3 flows as acceptance tests for the ported screens, against the real built
 * process (`npm run build -w @ueberblick/web` first). Almost every journey is `test.fixme` until its screen is ported;
 * docs/process/v3-journeys.md lists them. Own port and data directory, so it runs next to the other suites.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: join(JOURNEYS_DATA_DIR, 'results'),
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: '../../apps/web/test-results/e2e-journeys-report.json' }]],
  use: {
    baseURL: `http://localhost:${JOURNEYS_PORT}`,
    // v3 is a German app: its labels are the locators
    locale: 'de-DE',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // A port is done when its journeys pass in both (docs/process/v3-journeys.md); v3 switches layout at 768 px.
  projects: phoneAndDesktop(),
  webServer: {
    command: 'node build/index.js',
    cwd: '../../apps/web',
    url: `http://localhost:${JOURNEYS_PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(JOURNEYS_PORT),
      HOST: 'localhost',
      PUBLIC_URL: `http://localhost:${JOURNEYS_PORT}`,
      DATA_DIR: JOURNEYS_DATA_DIR,
      UEBERBLICK_INSECURE_COOKIES: '1',
      TIMERS_INTERVAL_S: '0',
    },
  },
});
