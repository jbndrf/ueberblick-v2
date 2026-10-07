import { defineConfig } from '@playwright/test';
import { componentRun, phoneAndDesktop } from '../../../../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-634 e2e (the Aktivität tab at both sizes): `npx playwright test -c apps/web/src/lib/participant/feature/activity/e2e/playwright.config.ts`.
 * Phone and desktop (the shared device projects, `phoneAndDesktop()`). The page is a Vite harness over the real tab.
 */
const { port: PORT, outputDir } = componentRun('comp:web/lib-participant-feature-activity', 4183);

export default defineConfig({
  testDir: '.',
  outputDir,
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, locale: 'de-DE', trace: 'retain-on-failure' },
  projects: phoneAndDesktop(),
  webServer: {
    command: `npx vite --config apps/web/src/lib/participant/feature/activity/e2e/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
