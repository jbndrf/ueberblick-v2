import '../../scripts/ops/vitest-scoped.guard.mjs';
import { defineConfig } from 'vitest/config';

// Tests of the browser benchmark tooling only (fast, no browser). Run: npm run bench:browser:test
export default defineConfig({
  test: { include: ['bench/browser/**/*.spec.ts'], exclude: ['**/node_modules/**', '.claude/**'] },
});
