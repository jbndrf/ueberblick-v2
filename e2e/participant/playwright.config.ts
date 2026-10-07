import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// `npm run e2e` sets E2E_PARTICIPANT_PORT and E2E_PARTICIPANT_DATA_DIR per run; the fallbacks serve a single direct run only.
export const PARTICIPANT_PORT = Number(process.env['E2E_PARTICIPANT_PORT'] ?? 4175);
export const PARTICIPANT_DATA_DIR =
  process.env['E2E_PARTICIPANT_DATA_DIR'] ?? join(tmpdir(), 'ueberblick-e2e-participant');

if (process.env['TEST_WORKER_INDEX'] === undefined)
  rmSync(PARTICIPANT_DATA_DIR, { recursive: true, force: true });

/**
 * Participant app e2e (WP-550) against the real built process: `npm run build -w @ueberblick/web` first, then
 * `npx playwright test -c e2e/participant/playwright.config.ts`. Its own port and data directory keep it apart from
 * apps/web/e2e and e2e/a11y.
 */
export default defineConfig({
  testDir: '.',
  outputDir: join(PARTICIPANT_DATA_DIR, 'results'),
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: '../../apps/web/test-results/e2e-participant-report.json' }]],
  use: {
    baseURL: `http://localhost:${PARTICIPANT_PORT}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node build/index.js',
    cwd: '../../apps/web',
    url: `http://localhost:${PARTICIPANT_PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(PARTICIPANT_PORT),
      HOST: 'localhost',
      PUBLIC_URL: `http://localhost:${PARTICIPANT_PORT}`,
      DATA_DIR: PARTICIPANT_DATA_DIR,
      UEBERBLICK_INSECURE_COOKIES: '1',
      TIMERS_INTERVAL_S: '0',
    },
  },
});
