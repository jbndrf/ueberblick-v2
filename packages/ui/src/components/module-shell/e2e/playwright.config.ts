import { defineConfig } from '@playwright/test';
import { componentRun, phoneAndDesktop } from '../../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-641 e2e (the shared detail shell at phone 390x844 and desktop 1280x800): `npx playwright test -c
 * packages/ui/src/components/module-shell/e2e/playwright.config.ts`. The page is a Vite harness over the real shell.
 * The port env name is the one scripts/e2e/discover.mjs derives from the suite id (`portEnvFor`).
 */
const { port: PORT, outputDir } = componentRun('comp:ui/components-module-shell', 4184);

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
    command: `npx vite --config packages/ui/src/components/module-shell/e2e/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
