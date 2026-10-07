import fc from 'fast-check';

// Property failures print seed and path (verbose); FC_SEED replays a failure from the CI log.
const seed = process.env['FC_SEED'];
fc.configureGlobal({
  verbose: fc.VerbosityLevel.Verbose,
  ...(seed === undefined ? {} : { seed: Number(seed) }),
});

// Specs that start the app runtime must not build offline packs in the background (WP-351): it costs seconds under load
// and nothing waits for it. A pack spec passes `packBuild` to its runtime explicitly.
process.env['PACK_BUILD'] ??= '0';

// UI specs (jsdom) wait with findBy*/waitFor. testing-library's 1 s default failed under train load while the same spec
// passed 3/3 alone (ToolsSlot.ui.spec.ts:126, 2026-10-03); 5 s stays far below testTimeout and still catches a real
// miss. Node specs never load testing-library here.
if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/dom');
  configure({ asyncUtilTimeout: 5_000 });
}
