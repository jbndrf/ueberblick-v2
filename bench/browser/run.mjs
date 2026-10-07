// npm run bench:browser [-- --only <id> --runs <n> --slow <ms> --self-test]
// Builds the scenario pages, runs each in headless Chromium (CPU x4, Fast 4G), prints a table and
// exits non-zero when a budget is missed. Not part of `npm run check`: it takes minutes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages, serve } from './lib/build.mjs';
import { launch, openSession, PROFILE } from './lib/browser.mjs';
import { aggregateRuns } from './lib/aggregate.mjs';
import { judgeAll, renderTable, SLOW_PARAM } from './lib/verdict.mjs';
import { SCENARIOS } from './scenarios.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const selfTest = flag('self-test');
const runs = Number(opt('runs', selfTest ? '1' : '3'));
const slow = Number(opt('slow', selfTest ? '3500' : '0'));
const only = opt('only', undefined);
const query = slow > 0 ? `?${SLOW_PARAM}=${slow}` : '';
const chosen = SCENARIOS.filter((s) => only === undefined || s.id === only);
if (chosen.length === 0)
  throw new Error(`no scenario "${only}"; known: ${SCENARIOS.map((s) => s.id).join(', ')}`);

await buildPages([...new Set(chosen.map((s) => s.page))]);
const server = await serve();
const browser = await launch();
const measurements = [];
let failed = false;
try {
  for (const sc of chosen) {
    const perRun = [];
    for (let i = 0; i < runs; i++) {
      const rows = await sc.run(() => openSession(browser, server.base), query);
      perRun.push(rows);
      console.log(`${sc.id} run ${i + 1}/${runs} done`);
    }
    // One measurement per (scenario, label): the median over the runs (info rows: the worst run).
    measurements.push(...aggregateRuns(sc.id, perRun));
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  server.close();
}

const { rows, info } = judgeAll(measurements);
console.log(
  `\nprofile: CPU x${PROFILE.cpuRate}, Fast 4G (${PROFILE.network.latency} ms, ` +
    `${Math.round((PROFILE.network.downloadThroughput * 8) / 1024 / 1024)} Mbit/s), software GL, median of ${runs} run(s)` +
    (slow > 0 ? `, SLOWED by ${slow} ms on purpose` : ''),
);
console.log(renderTable(rows));
for (const m of info)
  console.log(
    `info (not judged): ${m.scenario} ${m.label} = ${Math.round(m.value * 10) / 10} ${m.budget.unit}`,
  );

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, '.results'), { recursive: true });
writeFileSync(
  join(here, '.results', selfTest ? 'self-test.json' : 'latest.json'),
  JSON.stringify({ date: new Date().toISOString(), runs, slow, profile: PROFILE, rows }, null, 1),
);

if (selfTest) {
  // Every scenario must have noticed the slowdown: at least one FAIL row each.
  const missed = chosen.filter(
    (sc) => !rows.some((r) => r.scenario.startsWith(sc.id.split('-')[0]) && !r.pass),
  );
  const ok = !failed && missed.length === 0;
  console.log(
    ok
      ? 'self-test OK: the slowed scenarios failed their budgets'
      : `self-test FAILED: no FAIL row for ${missed.map((s) => s.id).join(', ')}`,
  );
  process.exit(ok ? 0 : 1);
}
const breached = rows.filter((r) => !r.pass);
if (breached.length > 0 || failed || rows.length === 0) {
  console.error(
    `bench:browser FAILED: ${breached.length} budget(s) missed${failed ? ', scenario error' : ''}`,
  );
  process.exit(1);
}
console.log('bench:browser OK: all budgets met');
