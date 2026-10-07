import { defineConfig } from '@playwright/test';
import { componentRun, phoneAndDesktop } from '../../../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-652 e2e (the + flow: picker, pin, confirm pill, the bar that hides) over the real MapLibre map at phone 390x844 and
 * desktop 1280x800: `node scripts/e2e/run.mjs --suite comp:web/lib-participant-create`. No tiles, no network.
 */
const { port: PORT, outputDir } = componentRun('comp:web/lib-participant-create', 4186);

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
    command: `npx vite --config apps/web/src/lib/participant/create/e2e/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
