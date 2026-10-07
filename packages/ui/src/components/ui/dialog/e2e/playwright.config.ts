import { defineConfig } from '@playwright/test';
import { componentRun, phoneAndDesktop } from '../../../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-663 e2e (a MultiSelect inside the kit Dialog is not clipped): `npx playwright test -c
 * packages/ui/src/components/ui/dialog/e2e/playwright.config.ts`. Phone and desktop, a Vite harness, no server data.
 */
const { port: PORT, outputDir } = componentRun('comp:ui/components-ui-dialog', 4184);

export default defineConfig({
  testDir: '.',
  outputDir,
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, locale: 'en-US', trace: 'retain-on-failure' },
  projects: phoneAndDesktop(),
  webServer: {
    command: `npx vite --config packages/ui/src/components/ui/dialog/e2e/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
