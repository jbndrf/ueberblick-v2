import '../../scripts/ops/vitest-scoped.guard.mjs';
import { defineConfig } from 'vitest/config';

// Tests of the bench tooling itself (harness, generator). Not part of `npm run check`: the 60k generator
// test takes a while. Run: npm run bench:test
export default defineConfig({
  test: {
    include: ['bench/harness/**/*.spec.ts', 'bench/generate/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '.claude/**'],
    testTimeout: 180_000,
  },
});
