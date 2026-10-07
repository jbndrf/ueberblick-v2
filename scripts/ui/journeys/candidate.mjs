// From steps.json to a proven test candidate: codegen, then 3 headless runs. 3 of 3 passes is `ready`
// (apps/web/e2e/candidates/<journey>.spec.ts), anything else is `unstable` (<journey>.unstable.ts, which
// Playwright does not pick up, with the failure in the first line). No expectation means no candidate:
// a test that asserts nothing proves nothing.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSpec } from '../codegen.mjs';

export const RUNS = 3;
export const CANDIDATE = { READY: 'ready', UNSTABLE: 'unstable', NONE: 'none' };
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const CANDIDATES_DIR = join(ROOT, 'apps/web/e2e/candidates');

const walk = (suites) => (suites ?? []).flatMap((s) => [...(s.specs ?? []), ...walk(s.suites)]);

/** Default runner port: Playwright, `--repeat-each=3`, JSON reporter. Returns {passes, runs, failure}. */
export function runPlaywright(specPath, runs = RUNS) {
  const r = spawnSync(
    'npx',
    [
      'playwright',
      'test',
      '-c',
      'e2e/candidates/playwright.config.ts',
      specPath,
      `--repeat-each=${runs}`,
      '--reporter=json',
    ],
    {
      cwd: join(ROOT, 'apps/web'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CI: '1' },
    },
  );
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    return {
      passes: 0,
      runs,
      failure: (r.stderr || r.stdout || 'playwright did not report').trim().split('\n').pop(),
    };
  }
  const results = walk(report.suites).flatMap((s) => s.tests.flatMap((t) => t.results));
  const bad = results.find((x) => x.status !== 'passed');
  const failure = bad
    ? (bad.error?.message ?? bad.status).replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0]
    : undefined;
  return { passes: results.filter((x) => x.status === 'passed').length, runs, failure };
}

/**
 * @param {{journey:string, doc:object, dir?:string, run?:(specPath:string)=>{passes:number,runs:number,failure?:string}}} p
 * @returns {{status:string, file:string|null, detail:string}}
 */
export function makeCandidate({ doc, dir = CANDIDATES_DIR, run = runPlaywright }) {
  const { spec, skipped, expectations } = generateSpec(doc);
  const base = join(dir, doc.journey);
  for (const f of [`${base}.spec.ts`, `${base}.unstable.ts`]) rmSync(f, { force: true });
  if (expectations === 0)
    return { status: CANDIDATE.NONE, file: null, detail: 'the explorer recorded no expectation' };
  const file = `${base}.spec.ts`;
  writeFileSync(`${base}.steps.json`, `${JSON.stringify(doc, null, 2)}\n`);
  writeFileSync(file, spec);
  const res = run(file);
  const stable = res.passes === res.runs && skipped === 0;
  const detail = stable
    ? `${res.passes}/${res.runs} passes`
    : [
        `${res.passes}/${res.runs} passes`,
        skipped ? `${skipped} step(s) without a stable locator` : '',
        res.failure ?? '',
      ]
        .filter(Boolean)
        .join('; ');
  const marked = readFileSync(file, 'utf8').replace(
    '// candidate: pending',
    `// candidate: ${stable ? CANDIDATE.READY : `${CANDIDATE.UNSTABLE} (${detail.replace(/\n/g, ' ')})`}`,
  );
  if (stable) {
    writeFileSync(file, marked);
    return { status: CANDIDATE.READY, file, detail };
  }
  const out = `${base}.unstable.ts`;
  writeFileSync(out, marked);
  rmSync(file, { force: true });
  return { status: CANDIDATE.UNSTABLE, file: out, detail };
}
