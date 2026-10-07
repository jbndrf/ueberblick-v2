import '../../scripts/ops/vitest-scoped.guard.mjs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['bench/geo/*.bench.ts'], testTimeout: 120_000 },
});
