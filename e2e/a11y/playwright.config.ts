import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { PARTICIPANT_DATA_DIR, PARTICIPANT_PORT } from '../participant/playwright.config';

// `npm run e2e` sets E2E_A11Y_PORT and E2E_A11Y_DATA_DIR per run; the fallbacks serve a single direct run only.
export const A11Y_PORT = Number(process.env['E2E_A11Y_PORT'] ?? 4174);
export const A11Y_DATA_DIR = process.env['E2E_A11Y_DATA_DIR'] ?? join(tmpdir(), 'ueberblick-e2e-a11y');

if (process.env['TEST_WORKER_INDEX'] === undefined) rmSync(A11Y_DATA_DIR, { recursive: true, force: true });

/**
 * Accessibility e2e (WP-554) against the real built process: `npm run build -w @ueberblick/web` first, then
 * `npx playwright test -c e2e/a11y/playwright.config.ts`. Two servers: the control and builder pages on their own port
 * and data directory (kept apart from apps/web/e2e), and the participant app in the world of e2e/participant
 * (WP-554.5: same seed, same data directory and port, so `world.ts` is reused and not copied).
 */
export default defineConfig({
  testDir: '.',
  outputDir: join(A11Y_DATA_DIR, 'results'),
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  // bypassCSP: axe is injected as a script; the CSP itself is asserted in apps/web/e2e/security-headers.spec.ts.
  reporter: [['list'], ['json', { outputFile: '../../apps/web/test-results/e2e-a11y-report.json' }]],
  use: { bypassCSP: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'pages', testMatch: 'pages.spec.ts', use: { baseURL: `http://localhost:${A11Y_PORT}` } },
    {
      name: 'participant',
      testMatch: 'participant.spec.ts',
      use: { baseURL: `http://localhost:${PARTICIPANT_PORT}`, locale: 'en-US' },
    },
  ],
  webServer: [
    {
      command: 'node build/index.js',
      cwd: '../../apps/web',
      url: `http://localhost:${A11Y_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(A11Y_PORT),
        HOST: 'localhost',
        PUBLIC_URL: `http://localhost:${A11Y_PORT}`,
        DATA_DIR: A11Y_DATA_DIR,
        UEBERBLICK_INSECURE_COOKIES: '1',
      },
    },
    {
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
  ],
});
