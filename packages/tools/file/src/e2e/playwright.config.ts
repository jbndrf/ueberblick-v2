import { defineConfig } from '@playwright/test';
import { componentRun, phoneAndDesktop } from '../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-658 component e2e (the file tool, v3 "Dateien" button): `npx playwright test -c packages/tools/file/src/e2e/playwright.config.ts`.
 * Phone and desktop projects from the shared definition. The page is a Vite harness with a fake blob port.
 */
const { port: PORT, outputDir } = componentRun('comp:tools-file', 4183);

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
    command: `npx vite --config packages/tools/file/src/e2e/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
