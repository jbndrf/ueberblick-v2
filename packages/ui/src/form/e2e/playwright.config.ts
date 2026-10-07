import { defineConfig } from '@playwright/test';
import { componentRun, phoneAndDesktop } from '../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-643 e2e (the task form in the shared detail shell with v3's form chrome): `node scripts/e2e/run.mjs --suite
 * comp:ui/form`. Phone 390x844 and desktop 1280x800 (`phoneAndDesktop`). The page is a Vite harness: the real shell, the
 * real form renderer and flow, a stand-in form session. The port env name is the one `portEnvFor` derives from the id.
 */
const { port: PORT, outputDir } = componentRun('comp:ui/form', 4191);

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
    command: `npx vite --config packages/ui/src/form/e2e/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
