#!/usr/bin/env node
// `npm run bench`: runs every bench/**/*.bench.ts under vitest, collects the budget lines the benchmarks
// report, prints them, writes metrics/raw/bench/<date>.json and exits non-zero on a breach.
// Options (for tests): --config <vitest config>, --out-dir <dir>, --date <YYYY-MM-DD>. Any other argument is a vitest file
// filter (`npm run bench -- builder-views` runs only the bench files whose path contains it); `--strict` as documented.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scopedTmp } from '../../scripts/ops/vitest-scoped.mjs';
import { append, rawDir } from '../../scripts/metrics/lib.mjs';
import { formatLine, verdictOf } from './budget.mjs';
import { docRows, renderRows } from './rows.mjs';
import { summarise } from './summary.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const VALUED = new Set(['--config', '--out-dir', '--date']);
const customConfigGiven = () => args.includes('--config');
/** Positional arguments: vitest file filters. Values of the options above are not filters. */
const filters = args.filter((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1] ?? ''));
// A filter that matches no bench file is refused: vitest would report "no test files" and nothing would be measured.
if (filters.length && !customConfigGiven()) {
  const files = globSync('bench/**/*.bench.ts');
  const unmatched = filters.filter((f) => !files.some((file) => file.includes(f)));
  if (unmatched.length) {
    console.error(
      `bench: no bench file matches ${unmatched.join(', ')} (bench files are bench/<dir>/*.bench.ts; pass a dir name or path)`,
    );
    process.exit(64);
  }
}
const strict = args.includes('--strict') || process.env.BENCH_STRICT === '1';
const config = opt('config', 'bench/vitest.config.ts');
const date = opt('date', new Date().toISOString().slice(0, 10));
const customOut = opt('out-dir', undefined);
const outDir = customOut ?? join(rawDir(), 'bench');

const tmp = scopedTmp('bench-');
const scratch = tmp.dir;
const reportFile = join(scratch, 'report.jsonl');
writeFileSync(reportFile, '');
const startedAt = Date.now();
const run = spawnSync('npx', ['vitest', 'run', '-c', config, ...filters], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...tmp.env, BENCH_REPORT: reportFile, ...(strict ? { BENCH_STRICT: '1' } : {}) },
});

const durationMs = Date.now() - startedAt;
const reported = readFileSync(reportFile, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
tmp.remove();
const { lines, ok } = summarise(reported, strict);

console.log(`\nSuite duration: ${(durationMs / 1000).toFixed(1)} s (bench files run one at a time)`);
console.log('\nBudgets');
if (lines.length === 0) console.log('  (no benchmark reported a budget line)');
for (const l of lines) console.log(`  ${formatLine(l, strict)}`);

// The docs/12 rows. The browser bench (npm run bench:browser) measures the device rows on the device profile;
// its last result counts too, when there is one (rows carry the same fields as the lines).
const browserFile = join(import.meta.dirname, '..', 'browser', '.results', 'latest.json');
const browserLines =
  !customOut && existsSync(browserFile) ? JSON.parse(readFileSync(browserFile, 'utf8')).rows : [];
const rows = docRows([...lines, ...browserLines]);
console.log('\ndocs/12 rows (adjusted values)');
console.log(renderRows(rows));

mkdirSync(outDir, { recursive: true });
const passed = ok && run.status === 0;
writeFileSync(
  join(outDir, `${date}.json`),
  JSON.stringify({ date, ok: passed, vitestExit: run.status, durationMs, lines, rows }, null, 2) + '\n',
);
for (const l of lines) {
  const entry = {
    name: l.id,
    value: l.adjusted,
    raw: l.value,
    unit: l.unit,
    budget: l.limit,
    row: l.row ?? null,
    device: l.device,
    load: l.load ?? null,
    verdict: verdictOf(l, l.load, strict),
  };
  if (customOut) appendFileSync(join(outDir, 'bench.jsonl'), JSON.stringify(entry) + '\n');
  else append('bench.jsonl', entry);
}
const unreliable = lines.filter((l) => verdictOf(l, l.load, strict) === 'UNRELIABLE');
if (unreliable.length > 0) {
  console.log(
    `\nUNRELIABLE lines (${unreliable.length}): over budget on a busy machine, not counted as failures. Rerun when the load per core is low, or with --strict.`,
  );
  for (const l of unreliable) console.log(`  ${formatLine(l, strict)}`);
}
if (!ok) console.error('\nBudget exceeded.');
process.exit(passed ? 0 : 1);
