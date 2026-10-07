import { defineConfig } from '@playwright/test';
import { componentRun } from '../../../../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-644 e2e (the Daten read view): `npx playwright test -c apps/web/src/lib/participant/feature/data/e2e/playwright.config.ts`.
 * Two projects, the sizes the owner named: phone 390x844 and desktop 1280x800 (until lead-c's shared projects serve this
 * area). The page is a Vite harness, no server data needed.
 */
const { port: PORT, outputDir } = componentRun('comp:web/lib-participant-feature-data', 4182);

export default defineConfig({
  testDir: '.',
  outputDir,
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, locale: 'de-DE', trace: 'retain-on-failure' },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `npx vite --config apps/web/src/lib/participant/feature/data/e2e/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
