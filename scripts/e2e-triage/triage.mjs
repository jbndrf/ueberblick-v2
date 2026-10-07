#!/usr/bin/env node
// `npm run e2e:triage [-- --report <path>]`: the local model classifies the failures of the last
// `npm run e2e`, every suite of allSuites (fixed and discovered) (docs/process/e2e-triage.md). Exits 0 whenever a report could be written.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawDir } from '../metrics/lib.mjs';
import { chat, gpuFree } from '../local-model.mjs';
import { allSuites } from '../e2e/run.mjs';
import { reportTargets } from '../e2e/discover.mjs';
import { runTriage } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const custom = arg('--report');
// One place for the suites and their report paths: scripts/e2e/run.mjs.
const targets = custom
  ? [{ suite: '(custom)', path: resolve(custom) }]
  : reportTargets(allSuites(ROOT), ROOT);
if (custom && !existsSync(targets[0].path)) {
  console.error(`e2e-triage: no report at ${targets[0].path}.`);
  process.exit(1);
}
const reports = targets.map((t) => ({
  suite: t.suite,
  report: existsSync(t.path) ? JSON.parse(readFileSync(t.path, 'utf8')) : null,
}));
const safeGpuFree = async () => {
  try {
    return await gpuFree();
  } catch {
    return true; // config error surfaces in chat(), which classifies as unknown
  }
};
const r = await runTriage({
  reports,
  model: { chat, gpuFree: safeGpuFree },
  dir: rawDir(),
});
console.log(
  `e2e-triage: ${
    Object.entries(r.byClass)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ') || 'no failures'
  } · ${r.file}`,
);
