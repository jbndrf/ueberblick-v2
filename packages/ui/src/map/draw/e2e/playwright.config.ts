import { defineConfig } from '@playwright/test';
import { componentRun, phoneAndDesktop } from '../../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-635 e2e (drawing a line or an area on the real MapLibre map): `npx playwright test -c
 * packages/ui/src/map/draw/e2e/playwright.config.ts`. Phone 390x844 and desktop 1280x800 (v3 switches at 768 px).
 * The page is a Vite harness; the map has no tiles, so no network is needed.
 */
const { port: PORT, outputDir } = componentRun('comp:ui/map-draw', 4182);

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
    command: `npx vite --config packages/ui/src/map/draw/e2e/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
