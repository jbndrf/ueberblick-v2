import './scripts/ops/vitest-scoped.guard.mjs';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { maplibreDefine } from './apps/web/maplibre-version';
import { fileURLToPath } from 'node:url';
import { rerunTriggers } from './scripts/ops/rerun-triggers.mjs';
import { fsModuleCacheOn, lockHash } from './scripts/ops/vitest-cache.mjs';
import { WORKER_HEAP_MB } from './scripts/ops/resources.mjs';

// WP-932: transformed modules persist between runs. Vitest keys each entry by file content, its own version and
// plugin *names*, not plugin versions, so the lockfile hash names the directory: new dependencies, fresh cache.
// Per worktree: WP-904 never links node_modules/.cache. WP-993: on in every checkout (worktrees too) unless the disk has under 8 GB free (fsModuleCacheOn); housekeep prunes idle caches.
const root = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const fsCache = fsModuleCacheOn(root);
const lockDir = lockHash(root) ?? 'no-lockfile';

export default defineConfig({
  // what the app build defines, so specs of `apps/web` run against the same constants
  define: maplibreDefine,
  // packages/ui: Svelte components, compiled with injected CSS; Paraglide messages compiled by the global setup.
  plugins: [svelte({ compilerOptions: { css: 'injected' } }), svelteTesting()],
  test: {
    include: [
      'packages/**/src/**/*.spec.ts',
      'apps/*/src/**/*.spec.ts',
      'scripts/**/*.spec.{ts,mjs}',
      'fixtures/golden/**/*.spec.ts',
    ],
    exclude: ['**/node_modules/**', 'reference/**', '.claude/**'],
    // Forks isolate memory per worker; the heap cap makes a runaway test fail instead of pushing the
    // shared server into OOM. Worker count comes from test-record (fair share of cores and memory).

    // A beforeAll that starts the app runtime (imports, password hash, pack queue) takes ~8 s cold at load 45; the 10 s
    // default refused lands (layout.server.spec, 2026-10-02). 60 s still catches a hang.
    hookTimeout: 60_000,
    // A train on 2026-10-03 refused an innocent branch on five tests at 5.0–6.0 s (fast-check properties, a phone-layout
    // UI spec) at peak load; 15 s keeps a real hang visible without failing CPU-heavy tests under contention.
    testTimeout: 15_000,
    setupFiles: ['./vitest.setup.ts'],
    globalSetup: [
      './packages/ui/vitest.global-setup.ts',
      './packages/builder/vitest.global-setup.ts',
      './packages/tools/vitest.global-setup.ts',
      './apps/web/vitest.global-setup.ts',
    ],
    // WP-610: Svelte libraries of the design kit ship .svelte files; Vite must compile them, not leave them to Node.
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
          /@xyflow\/svelte/,
        ],
      },
    },
    pool: 'forks',
    fsModuleCache: fsCache,
    ...(fsCache ? { fsModuleCachePath: `node_modules/.cache/vitest-modules/${lockDir}` } : {}),
    // WP-935: a change to any of these makes `npm run check:changed` run every test (scripts/ops/rerun-triggers.mjs).
    forceRerunTriggers: rerunTriggers(root),
    execArgv: [`--max-old-space-size=${WORKER_HEAP_MB}`],
  },
});
