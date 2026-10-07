#!/usr/bin/env node
// Development metrics report (docs/process/metrics.md). Reads git, work-package Logs, metrics/raw
// and Claude Code transcripts; prints Markdown. Course checks commit it with --out.
// Usage: node scripts/metrics/report.mjs [--since YYYY-MM-DD] [--out]
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { git, rawDir, readJsonl, pct, sum, ratio, fmtK, hours } from './lib.mjs';
import { wpFlow, mainCommits } from './flow.mjs';
import { latestBenchRows, rowCells } from './bench-rows.mjs';
import { claudeUsage } from './claude-usage.mjs';
import { e2eRows } from './e2e-rows.mjs';
import { e2eRunRows, landLatencyRows, loadLandEvents } from './wait-rows.mjs';
import { checkStepsRows } from './check-steps-rows.mjs';
import { summarize as selectionOf, summaryLine as selectionLine } from './selection.mjs';
import { journeysRows } from './journeys-rows.mjs';
import { parityRow } from './parity-rows.mjs';
import { loadRows as reworkRows, reportRow as reworkRow } from './rework.mjs';

const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const lastReport = existsSync('metrics/reports')
  ? readdirSync('metrics/reports')
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .at(-1)
  : null;
const until = new Date();
const since = new Date(arg('--since') ?? lastReport?.slice(0, 10) ?? Date.now() - 14 * 86_400_000);
const inWindow = (e) => new Date(e.at) >= since && new Date(e.at) < until;
const days = Math.max(1, (until - since) / 86_400_000);
const out = [];
const flags = [];
const p = (...l) => out.push(...l);
const table = (head, rows) =>
  rows.length
    ? [
        `| ${head.join(' | ')} |`,
        `|${head.map(() => '---').join('|')}|`,
        ...rows.map((r) => `| ${r.join(' | ')} |`),
      ]
    : ['_no data yet_'];

p(`# Development metrics ${since.toISOString().slice(0, 10)} → ${until.toISOString().slice(0, 10)}`, '');

// 1. Delivery (DORA, adapted to an agent team)
const wps = wpFlow(since, until);
const commits = mainCommits(since, until);
const fixes = commits.filter((c) => c.fixesWp || c.revert);
const mainRuns = readJsonl('tests.jsonl').filter((t) => t.branch === 'main' && inWindow(t));
const redSpells = [];
let redSince = null;
for (const t of mainRuns) {
  const red = t.failed > 0 || t.crashed;
  if (red && !redSince) redSince = new Date(t.at);
  if (!red && redSince) {
    redSpells.push(new Date(t.at) - redSince);
    redSince = null;
  }
}
const cycles = wps.map((w) => w.cycleMs).filter((x) => x !== null);
p(
  '## 1. Delivery',
  ...table(
    ['metric', 'value', 'what it tells'],
    [
      ['work packages merged', `${wps.length} (${(wps.length / days).toFixed(2)}/day)`, 'throughput'],
      [
        'cycle time p50 / p90',
        `${hours(pct(cycles, 50))} / ${hours(pct(cycles, 90))}`,
        'start → merged, from WP Logs',
      ],
      [
        'change failure rate',
        `${ratio(fixes.length, wps.length)} (${fixes.length} fix/revert commits)`,
        'merged work that needed repair (`Fixes-WP:` trailer, reverts)',
      ],
      [
        'red main',
        `${redSpells.length + (redSince ? 1 : 0)} times, recovery p50 ${hours(pct(redSpells, 50))}`,
        'main must always be green',
      ],
      [
        'commits on main',
        `${commits.length} (${commits.filter((c) => c.docsync).length} docsync merges)`,
        '',
      ],
      reworkRow(reworkRows(), until.toISOString().slice(0, 10)),
      ...[parityRow()].filter(Boolean),
    ],
  ),
  '',
);
if (wps.length >= 5 && fixes.length / wps.length > 0.2)
  flags.push('change failure rate > 20%: reviews or tests miss defects');
if (redSince) flags.push('main is red right now');

// 2. Review and rework
const rounds = wps.map((w) => w.rounds);
p(
  '## 2. Review and rework',
  ...table(
    ['metric', 'value'],
    [
      [
        'review rounds per WP (avg / max)',
        `${(sum(rounds) / (rounds.length || 1)).toFixed(1)} / ${Math.max(0, ...rounds)}`,
      ],
      ['first-pass PASS', ratio(wps.filter((w) => w.firstPass).length, wps.length)],
      ['escalated (rewritten/re-dispatched)', `${wps.filter((w) => w.escalated).length}`],
      ['red lands (check, install, conflict)', `${sum(wps.map((w) => w.reverts))}`],
      ['blocked time (total)', hours(sum(wps.map((w) => w.blockedMs)))],
    ],
  ),
  '',
);
if (wps.length >= 5 && wps.filter((w) => w.firstPass).length / wps.length < 0.5)
  flags.push('first-pass rate < 50%: work packages or contracts are underspecified');

// 3. Tests and guardrails
const runs = readJsonl('tests.jsonl').filter(inWindow);
const latest = runs.filter((t) => t.branch === 'main' && !t.crashed).at(-1);
const first = readJsonl('tests.jsonl').find((t) => t.branch === 'main' && !t.crashed);
const flaky = new Set();
for (const [sha, rs] of Object.entries(Object.groupBy(runs, (t) => `${t.sha}:${t.tree ?? t.at}`))) {
  const failed = new Set(rs.flatMap((r) => r.failing ?? []));
  for (const name of failed)
    if (rs.some((r) => !r.crashed && !(r.failing ?? []).includes(name))) flaky.add(`${name} (${sha})`);
}
const guard = readJsonl('guardrails.jsonl').filter(inWindow);
p(
  '## 3. Tests and guardrails',
  ...table(
    ['metric', 'value'],
    [
      ['tests on main (now / first recorded)', latest ? `${latest.total} / ${first?.total ?? '?'}` : 'n/a'],
      [
        'test runs (all branches)',
        `${runs.length}, red ${ratio(runs.filter((r) => r.failed || r.crashed).length, runs.length)}`,
      ],
      ['scoped runs, why they ran what they ran (24 h)', selectionLine(selectionOf(runs, { hours: 24 }), 24)],
      [
        'suite wall time p50 / latest',
        `${
          pct(
            runs.map((r) => r.wallMs),
            50,
          ) ?? 'n/a'
        } ms / ${latest?.wallMs ?? 'n/a'} ms`,
      ],
      [
        'test resources p50: workers / peak RSS / CPU use',
        `${
          pct(
            runs.map((r) => r.workers ?? 0),
            50,
          ) ?? 'n/a'
        } / ${
          pct(
            runs.map((r) => r.peakRssMb ?? 0),
            50,
          ) ?? 'n/a'
        } MB / ${Math.round(
          100 *
            (pct(
              runs.map((r) => r.cpuUtil ?? 0),
              50,
            ) ?? 0),
        )}% of all cores`,
      ],
      ['flaky candidates', flaky.size ? [...flaky].slice(0, 5).join('; ') : 'none'],
      [
        'guardrail hook blocks',
        `${guard.length} (${
          Object.entries(Object.groupBy(guard, (g) => g.rule))
            .map(([k, v]) => `${k} ${v.length}`)
            .join(', ') || '-'
        })`,
      ],
    ],
  ),
  '',
);
if (flaky.size) flags.push(`${flaky.size} flaky test candidates: fix before they erode trust in red`);
if (latest?.slowest?.length)
  p(`Slowest tests: ${latest.slowest.map((s) => `${s.name} ${s.ms} ms`).join(' · ')}`, '');

p(
  '### Check steps (WP-930)',
  ...table(
    ['suite or step', 'runs', 'p50', 'p90', 'red', 'load1 p50'],
    checkStepsRows(readJsonl('check-steps.jsonl').filter(inWindow)),
  ),
  '',
);

// 4. Claude usage
const cu = claudeUsage(since, until);
const agg = (key) =>
  Object.entries(Object.groupBy(cu, (r) => r[key]))
    .map(([k, rs]) => [
      k,
      rs.length,
      fmtK(sum(rs.map((r) => r.input + r.cacheWrite + r.cacheRead))),
      `${ratio(sum(rs.map((r) => r.cacheRead)), sum(rs.map((r) => r.input + r.cacheWrite + r.cacheRead)))}`,
      fmtK(sum(rs.map((r) => r.output))),
    ])
    .sort((a, b) => b[1] - a[1]);
p(
  '## 4. Claude tokens',
  '### By model',
  ...table(['model', 'calls', 'input (all)', 'cache hit', 'output'], agg('model')),
  '### By role',
  ...table(['role', 'calls', 'input (all)', 'cache hit', 'output'], agg('role')),
  '### By work package (top 10)',
  ...table(['wp', 'calls', 'input (all)', 'cache hit', 'output'], agg('wp').slice(0, 10)),
  wps.length
    ? `\nOutput tokens per merged WP: ${fmtK(Math.round(sum(cu.map((r) => r.output)) / wps.length))}`
    : '',
  '',
);

// 5. Local model (docsync)
const ev = readJsonl('docsync.jsonl').filter(inWindow);
const dr = ev.filter((e) => e.kind === 'run');
const oc = ev.filter((e) => e.kind === 'outcome');
const count = (xs, k, v) => xs.filter((x) => x[k] === v).length;
const pending = git('branch', '--list', 'docsync/*').split('\n').filter(Boolean).length;
p(
  '## 5. Local model (docsync, docs only)',
  ...table(
    ['metric', 'value'],
    [
      [
        'runs',
        `${dr.length}: proposed ${count(dr, 'status', 'proposed')}, no changes ${count(dr, 'status', 'no-changes')}, guardrail-rejected ${count(dr, 'status', 'rejected-guardrail')}`,
      ],
      [
        'tokens in / out / reasoning',
        `${fmtK(sum(dr.map((e) => e.tokensIn)))} / ${fmtK(sum(dr.map((e) => e.tokensOut)))} / ${fmtK(sum(dr.map((e) => e.tokensReasoning)))}`,
      ],
      [
        'time per run p50 / p95',
        `${Math.round(
          (pct(
            dr.map((e) => e.ms),
            50,
          ) ?? 0) / 1000,
        )} s / ${Math.round(
          (pct(
            dr.map((e) => e.ms),
            95,
          ) ?? 0) / 1000,
        )} s`,
      ],
      ['bounced (wrote nothing first)', ratio(dr.filter((e) => e.bounced).length, dr.length)],
      ['unverified names added', `${sum(dr.map((e) => e.invented))}`],
      [
        'Opus outcomes',
        `as-is ${count(oc, 'outcome', 'as-is')}, edited ${count(oc, 'outcome', 'edited')}, rejected ${count(oc, 'outcome', 'rejected')} · pending ${pending}`,
      ],
      ['rework ratio', ratio(sum(oc.map((e) => e.reworkLines)), sum(oc.map((e) => e.modelLines)))],
      [
        'review latency p50',
        `${
          pct(
            oc.map((e) => e.reviewMinutes),
            50,
          ) ?? 'n/a'
        } min`,
      ],
      ['deferred ticks / crashes', `${count(ev, 'kind', 'deferred')} / ${count(ev, 'kind', 'crash')}`],
    ],
  ),
  '',
);
if (oc.length >= 10 && count(oc, 'outcome', 'rejected') / oc.length > 0.4)
  flags.push('docsync rejected > 40%: it costs more review than it saves; narrow the scope or change model');
if (pending > 3) flags.push(`${pending} docsync branches wait for review`);

// 6. Performance budgets (bench scripts append to metrics/raw/bench.jsonl: {name, value, unit, budget})
const bench = Object.values(Object.groupBy(readJsonl('bench.jsonl'), (b) => b.name)).map((bs) => bs.at(-1));
p(
  '## 6. Performance budgets (docs/12)',
  ...table(
    ['benchmark', 'latest', 'budget', ''],
    bench.map((b) => [
      b.name,
      `${b.value} ${b.unit ?? ''}`,
      `${b.budget ?? '-'}`,
      b.budget && b.value > b.budget ? '**over**' : 'ok',
    ]),
  ),
  '',
);
const rowsNow = latestBenchRows(join(rawDir(), 'bench'));
p(
  `### docs/12 rows${rowsNow ? ` (adjusted values, bench of ${rowsNow.date})` : ''}`,
  ...(rowsNow
    ? table(['row', 'current', 'budget', 'measured by', 'derived from it'], rowCells(rowsNow.rows))
    : ['_no `npm run bench` result yet_']),
  '',
);
for (const b of bench)
  if (b.budget && b.value > b.budget) flags.push(`${b.name} over budget (${b.value} > ${b.budget})`);

// 7. Server health (logwatch: the local model reads the logs, Claude reads only ATTENTION.md)
const lw = readJsonl('logwatch.jsonl').filter(inWindow);
const digests = lw.filter((e) => e.kind === 'digest');
const tunes = lw.filter((e) => e.kind === 'tune');
const attentionOpen = existsSync(`${rawDir()}/ATTENTION.md`);
p(
  '## 7. Server health (logwatch)',
  ...table(
    ['metric', 'value'],
    [
      [
        'digests',
        `${digests.length} (deferred ${count(lw, 'kind', 'deferred')}) · ok ${count(digests, 'status', 'ok')}, attention ${count(digests, 'status', 'attention')}, alarm ${count(digests, 'status', 'alarm')}`,
      ],
      ['hard alarms', `${sum(digests.map((e) => e.alarms))}`],
      [
        'local model tokens in / out',
        `${fmtK(sum(lw.map((e) => e.tokensIn)))} / ${fmtK(sum(lw.map((e) => e.tokensOut)))}`,
      ],
      [
        'tuning proposals',
        `${sum(tunes.map((e) => e.proposals))} (high impact ${sum(tunes.map((e) => e.high))}) · latest in metrics/raw/logwatch/tune-*.md`,
      ],
      ['ATTENTION.md open', attentionOpen ? '**yes**' : 'no'],
    ],
  ),
  '',
);
if (attentionOpen) flags.push('metrics/raw/ATTENTION.md is open: the lead has not handled a logwatch alarm');
if (sum(tunes.map((e) => e.high)))
  flags.push('logwatch has high-impact tuning proposals: the strategist reads the latest tune report');

// 8. e2e triage (the local model classifies failures of `npm run e2e`)
const e2e = readJsonl('e2e.jsonl').filter(inWindow);
p('## 8. e2e triage', ...table(['metric', 'value'], e2eRows(e2e)), '');
// WP-1023: where agents wait (the rows look at the last 24 h / 7 days, not at the report window)
p(
  '### Waiting (WP-1023)',
  ...table(
    ['metric', 'value'],
    [...e2eRunRows(readJsonl('e2e-runs.jsonl')), ...landLatencyRows(loadLandEvents())],
  ),
  '',
);
if (e2e.some((e) => e.byClass?.['app-bug']))
  flags.push('e2e triage found app-bug failures: see metrics/raw/e2e/');

// 9. journeys (the local model explores the UI; recorded steps become test candidates)
const journeys = readJsonl('journeys.jsonl').filter(inWindow);
p('## 9. Journeys', ...table(['metric', 'value'], journeysRows(journeys)), '');

p('## Flags', ...(flags.length ? flags.map((f) => `- ${f}`) : ['none']), '');

const md = out.join('\n');
if (process.argv.includes('--out')) {
  mkdirSync('metrics/reports', { recursive: true });
  const file = `metrics/reports/${until.toISOString().slice(0, 10)}.md`;
  writeFileSync(file, md);
  console.log(`wrote ${file}`);
} else console.log(md);
