import { defineConfig } from '@playwright/test';
import { componentRun, phoneAndDesktop } from '../../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-636 e2e (the multi-step task flow, "Schritt n von m"): `npm run e2e -- comp:ui/form-steps`.
 * Phone 390x844 and desktop 1280x800 (`phoneAndDesktop`; v3 switches layout at 768 px). The page is a Vite harness,
 * no server data needed; its port comes from the env var the suite runner derives from the suite id.
 */
const { port: PORT, outputDir } = componentRun('comp:ui/form-steps', 4182);

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
    command: `npx vite --config packages/ui/src/form/steps/e2e/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
