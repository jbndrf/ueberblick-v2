import { defineConfig } from '@playwright/test';
import { componentRun, phoneAndDesktop } from '../../../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-661 e2e (Profil's Infoseiten list and dialog at both sizes):
 * `npx playwright test -c apps/web/src/lib/participant/info-pages/e2e/playwright.config.ts`.
 * The port env name is `portEnvFor('comp:web/lib-participant-info-pages')` from scripts/e2e/discover.mjs.
 */
const { port: PORT, outputDir } = componentRun('comp:web/lib-participant-info-pages', 4184);

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
    command: `npx vite --config apps/web/src/lib/participant/info-pages/e2e/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
