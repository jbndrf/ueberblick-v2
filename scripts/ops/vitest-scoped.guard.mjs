// Imported first by every vitest config (WP-141). Vitest creates <tmpdir>/<21 random chars> (~25 MB) per run
// and never removes it; scripts/ops/vitest-scoped.mjs scopes TMPDIR and sets UEB_VITEST_SCOPED=1. A config loads
// before vitest makes that directory, so refusing here leaks nothing.
// Escape hatch (for example an IDE plug-in): set UEB_VITEST_SCOPED=1 by hand and clean /tmp yourself.
export const SCOPED_ENV = 'UEB_VITEST_SCOPED';
export const REFUSAL = 'run tests with npm test -- <path> (vitest direct runs leak /tmp, WP-132)';

if (process.env[SCOPED_ENV] !== '1') {
  process.stderr.write(`${REFUSAL}\n`);
  process.exit(1);
}
