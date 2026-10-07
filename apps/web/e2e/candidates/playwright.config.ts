import { defineConfig } from '@playwright/test';

/**
 * Runs the generated journey candidates (docs/process/journeys.md): `npm run journeys` does it, 3 times each.
 * Every candidate seeds its own app (harness.ts), so there is no web server here.
 * Run from apps/web: `npx playwright test -c e2e/candidates/playwright.config.ts`.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  outputDir: '../../test-results/candidates',
  reporter: [['list']],
  timeout: 60_000,
});
