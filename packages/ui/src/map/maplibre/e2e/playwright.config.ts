import { defineConfig } from '@playwright/test';
import { componentRun, phoneAndDesktop } from '../../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-674 e2e (markers drawn by value on the real MapLibre map): `E2E_MARKERS_PORT=4183 npx playwright test -c
 * packages/ui/src/map/maplibre/e2e/playwright.config.ts`. Phone 390x844 and desktop 1280x800. The page is a Vite harness;
 * the map has no tiles, so no network is needed.
 */
const { port: PORT, outputDir } = componentRun('comp:ui/map-maplibre', 4183);

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
    command: `npx vite --config packages/ui/src/map/maplibre/e2e/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
