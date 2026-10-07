import { defineConfig } from '@playwright/test';
import {
  componentRun,
  paraglideStep,
  phoneAndDesktop,
} from '../../../../../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-666 component e2e (the Cluster tab at both sizes): `E2E_COMP_WEB_LIB_PARTICIPANT_SHEETS_FILTER_CLUSTER_PORT=4191 npx
 * playwright test -c apps/web/src/lib/participant/sheets/filter/cluster/e2e/playwright.config.ts` (the name is what
 * `portEnvFor` derives for `comp:web/lib-participant-sheets-filter-cluster`). The page is a Vite harness over the real
 * sheet, the real tab, the real preference record (in localStorage, offline) and the real cluster worker code.
 */
const { port: PORT, outputDir } = componentRun('comp:web/lib-participant-sheets-filter-cluster', 4191);
const HERE = 'apps/web/src/lib/participant/sheets/filter/cluster/e2e';

export default defineConfig({
  testDir: '.',
  outputDir,
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // v3 is a German app: its labels are the locators
  use: { baseURL: `http://localhost:${PORT}`, locale: 'de-DE', trace: 'retain-on-failure' },
  projects: phoneAndDesktop(),
  webServer: {
    command: `${paraglideStep()}npx vite --config ${HERE}/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
