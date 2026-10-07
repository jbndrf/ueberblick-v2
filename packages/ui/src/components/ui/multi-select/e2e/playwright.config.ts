import { defineConfig } from '@playwright/test';
import { componentRun } from '../../../../../../../scripts/e2e/component-config.mjs';

/**
 * WP-642 e2e (the kit MultiSelect through FieldInput): `npx playwright test -c packages/ui/src/components/ui/multi-select/e2e/playwright.config.ts`.
 * Two projects, the two sizes the owner named: phone 390x844 and desktop 1280x800. Until the shared journey
 * viewport projects exist (lead-c), this suite carries its own. The page is a Vite harness, no server data needed.
 */
const { port: PORT, outputDir } = componentRun('comp:ui/components-ui-multi-select', 4181);

export default defineConfig({
  testDir: '.',
  outputDir,
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, locale: 'en-US', trace: 'retain-on-failure' },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `npx vite --config packages/ui/src/components/ui/multi-select/e2e/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '../../../../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
