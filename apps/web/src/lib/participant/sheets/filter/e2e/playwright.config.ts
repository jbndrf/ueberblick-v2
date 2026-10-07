import { defineConfig } from '@playwright/test';
import {
  componentRun,
  paraglideStep,
  phoneAndDesktop,
} from '../../../../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-648 component e2e (the filter sheet at both sizes): `E2E_COMP_WEB_LIB_PARTICIPANT_SHEETS_FILTER_PORT=4190 npx playwright
 * test -c apps/web/src/lib/participant/sheets/filter/e2e/playwright.config.ts` (the name is what `portEnvFor` derives for
 * `comp:web/lib-participant-sheets-filter`). The page is a Vite harness over the real sheet and the real v3 kit CSS.
 */
const { port: PORT, outputDir } = componentRun('comp:web/lib-participant-sheets-filter', 4190);
const HERE = 'apps/web/src/lib/participant/sheets/filter/e2e';

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
    cwd: '../../../../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
