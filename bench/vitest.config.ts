import '../scripts/ops/vitest-scoped.guard.mjs';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

// Benchmarks run as timed tests (vitest 5 has no bench runner): npm test -- -c bench/vitest.config.ts
// The Svelte plugin lets a bench render a component (add `// @vitest-environment jsdom` to that file).
export default defineConfig({
  plugins: [svelte({ compilerOptions: { css: 'injected' } }), svelteTesting()],
  test: {
    include: ['bench/**/*.bench.ts'],
    exclude: ['**/node_modules/**', '.claude/**'],
    setupFiles: ['./vitest.setup.ts'],
    globalSetup: [
      './packages/ui/vitest.global-setup.ts',
      './packages/builder/vitest.global-setup.ts',
      './bench/harness/tool-messages.global-setup.ts',
      './apps/web/vitest.global-setup.ts',
    ],
    // One bench file at a time: a budget row is one operation on the device, so benches must not measure each
    // other (WP-921: parallel runs inflated four lines by 40-70 percent).
    fileParallelism: false,
    testTimeout: 60_000,
    // WP-610/623: the design kit's Svelte libraries ship .svelte files; Vite must compile them.
    server: {
      deps: {
        inline: [
          /bits-ui/,
          /runed/,
          /svelte-toolbelt/,
          /svelte-sonner/,
          /mode-watcher/,
          /vaul-svelte/,
          /@lucide\/svelte/,
        ],
      },
    },
  },
});
