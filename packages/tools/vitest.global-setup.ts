import { runAllCodegen } from '../../scripts/ops/codegen-stamp.mjs';

/**
 * WP-1004: generated code before the tests (Paraglide messages of ui, builder, every tool and the web app, and
 * `svelte-kit sync`, whose `.svelte-kit` apps/web/tsconfig.json extends). One shared run: all steps concurrently, each
 * skipped when its inputs are unchanged (`scripts/ops/codegen-stamp.mjs`); the four global setups await the same run.
 * Child processes, because the in-process compile API keeps a Vite server alive and delays the exit by about 10 s.
 */
export default function setup(): Promise<void> {
  return runAllCodegen();
}
