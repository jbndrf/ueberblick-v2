import { defineConfig } from '@playwright/test';
import {
  componentRun,
  paraglideStep,
  phoneAndDesktop,
} from '../../../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-653 component e2e (the cluster sheet at phone 390x844 and desktop 1280x800):
 * `node scripts/e2e/run.mjs --suite comp:web/lib-participant-cluster`, or
 * `E2E_COMP_WEB_LIB_PARTICIPANT_CLUSTER_PORT=4191 npx playwright test -c
 * apps/web/src/lib/participant/cluster/e2e/playwright.config.ts`. The page is a Vite harness over the real slot and
 * the real v3 kit CSS, with a stand-in map.
 */
const { port: PORT, outputDir } = componentRun('comp:web/lib-participant-cluster', 4191);
const HERE = 'apps/web/src/lib/participant/cluster/e2e';

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
    command: `${paraglideStep()}npx vite --config ${HERE}/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
