import { defineConfig } from '@playwright/test';
import { componentRun, phoneAndDesktop } from '../../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-646 e2e (Standort's accuracy circle and dot on the real MapLibre map): `npx playwright test -c
 * packages/ui/src/map/standort/e2e/playwright.config.ts`. Phone 390x844 and desktop 1280x800. No tiles, no network.
 */
const { port: PORT, outputDir } = componentRun('comp:ui/map-standort', 4183);

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
    command: `npx vite --config packages/ui/src/map/standort/e2e/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
