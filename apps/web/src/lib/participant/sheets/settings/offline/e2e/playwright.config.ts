import { defineConfig } from '@playwright/test';
import {
  componentRun,
  paraglideStep,
  phoneAndDesktop,
} from '../../../../../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-650 component e2e (the Offline tab and the download card at phone 390x844 and desktop 1280x800):
 * `E2E_COMP_WEB_LIB_PARTICIPANT_SHEETS_SETTINGS_OFFLINE_PORT=4191 npx playwright test -c
 * apps/web/src/lib/participant/sheets/settings/offline/e2e/playwright.config.ts` (the name is what `portEnvFor` derives
 * for `comp:web/lib-participant-sheets-settings-offline`). The page is a Vite harness over the real sheet and the real
 * v3 kit CSS, with a memory pack store and a fake pack server.
 */
const { port: PORT, outputDir } = componentRun('comp:web/lib-participant-sheets-settings-offline', 4191);
const HERE = 'apps/web/src/lib/participant/sheets/settings/offline/e2e';

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
