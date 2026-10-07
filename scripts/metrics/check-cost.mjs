#!/usr/bin/env node
// What the check gate costs (WP-953): per landed WP, how many full checks and check:changed runs it paid
// for, how long they took, and in which phase (before the first verdict, in fix rounds, after PASS).
// Land-staging checks (branch `HEAD`, the detached staging worktree) belong to a train, not to one WP,
// so they are one line of their own. Inputs: metrics/raw/check-steps.jsonl (suite check|changed, parent
// null = an outermost run), tests.jsonl (kind check = the vitest part of a full check) and
// work/events/*.log of the main checkout.
// Usage: npm run -s metrics:check-cost -- [--since <iso>] [--until <iso>]   (default: today, local time)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJsonl, rawDir } from './lib.mjs';

/** `wp/WP-12`, `wp/12` and `wp/WP-12-foo` are work package WP-12; `HEAD` (land staging) and lead branches are none. */
export function wpOfBranch(branch) {
  const m = /^wp\/(?:WP-)?(\d+(?:\.\d+)*)/.exec(branch ?? '');
  return m ? `WP-${m[1]}` : null;
}

/** Event logs (`YYYY-MM-DD HH:MM <event>`, local clock) from a Map of WP id to file text, as { wp -> [{ t, text }] }. */
export function parseEvents(texts) {
  const out = new Map();
  for (const [wp, text] of texts) {
    const list = [];
    for (const line of text.split('\n')) {
      const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d) (.+)$/.exec(line);
      if (m) list.push({ t: new Date(`${m[1]}T${m[2]}:00`).getTime(), text: m[3].trim() });
    }
    out.set(
      wp,
      list.sort((a, b) => a.t - b.t),
    );
  }
  return out;
}

const empty = () => ({
  full: 0,
  changed: 0,
  fullMs: 0,
  changedMs: 0,
  initial: 0,
  fix: 0,
  afterPass: 0,
  gateWaitMs: 0,
});

/** The phase of a run at time `t`: after a PASS verdict, in fix round n (n FAIL verdicts so far), or initial. */
function phaseOf(evs, t) {
  let fails = 0;
  let passed = false;
  for (const e of evs) {
    if (e.t > t) break;
    if (/^review \d+ FAIL/.test(e.text)) fails += 1;
    if (/^review \d+ PASS/.test(e.text)) passed = true;
  }
  return passed ? 'afterPass' : fails > 0 ? 'fix' : 'initial';
}

/**
 * Pure. `steps`/`tests`: raw JSONL records; `events`: parseEvents output; the window is [since, until).
 * Returns { rows (one per WP landed in the window), land, totals }.
 */
export function checkCost({ steps, tests, events, since, until = new Date(8.64e15) }) {
  const inWin = (at) => {
    const t = Date.parse(at);
    return t >= since.getTime() && t < until.getTime();
  };
  const landed = new Set();
  for (const [wp, evs] of events) {
    if (evs.some((e) => /^merged /.test(e.text) && e.t >= since.getTime() && e.t < until.getTime()))
      landed.add(wp);
  }
  const runs = steps.filter(
    (s) => (s.suite === 'check' || s.suite === 'changed') && !s.parent && inWin(s.at),
  );
  const per = new Map();
  const land = empty();
  const other = empty();
  const all = empty();
  const add = (acc, s) => {
    const kind = s.suite === 'check' ? 'full' : 'changed';
    acc[kind] += 1;
    acc[`${kind}Ms`] += s.wallMs ?? 0;
    acc.gateWaitMs += s.gateWaitMs ?? 0;
  };
  let anyWait = false;
  for (const s of runs) {
    if (typeof s.gateWaitMs === 'number') anyWait = true;
    add(all, s);
    if (s.branch === 'HEAD') {
      add(land, s);
      continue;
    }
    const wp = wpOfBranch(s.branch);
    if (!wp || !landed.has(wp)) {
      add(other, s);
      continue;
    }
    if (!per.has(wp)) per.set(wp, empty());
    const acc = per.get(wp);
    add(acc, s);
    acc[phaseOf(events.get(wp) ?? [], Date.parse(s.at))] += 1;
  }
  const rows = [...per.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .map(([wp, a]) => ({ wp, ...a }));
  const landedN = landed.size;
  return {
    rows,
    land,
    other,
    totals: {
      landed: landedN,
      fullChecks: all.full,
      changedRuns: all.changed,
      fullPerLanded: landedN ? all.full / landedN : null,
      fullMs: all.fullMs,
      changedMs: all.changedMs,
      gateWaitMs: anyWait ? all.gateWaitMs : null,
      fullTestRuns: tests.filter((r) => r.kind === 'check' && inWin(r.at)).length,
    },
  };
}

const h = (ms) => `${(ms / 3_600_000).toFixed(2)} h`;
const min = (ms) => `${(ms / 60_000).toFixed(1)} min`;

export function formatCheckCost(r) {
  const head = ['WP', 'full', 'full min', 'changed', 'changed min', 'initial', 'fix', 'after PASS'];
  const body = r.rows.map((x) => [
    x.wp,
    x.full,
    min(x.fullMs),
    x.changed,
    min(x.changedMs),
    x.initial,
    x.fix,
    x.afterPass,
  ]);
  const t = r.totals;
  const lines = [
    [head, ...body].map((row) => row.join(' | ')).join('\n'),
    '',
    `land staging (HEAD): ${r.land.full} full checks, ${min(r.land.fullMs)}; ${r.land.changed} changed runs`,
    `branches not landed in the window (or not a WP): ${r.other.full} full, ${r.other.changed} changed, ${min(r.other.fullMs + r.other.changedMs)}`,
    '',
    `WPs landed: ${t.landed}`,
    `full checks (all branches, incl. land): ${t.fullChecks} (${t.fullTestRuns} full vitest runs in tests.jsonl)`,
    `full checks per landed WP: ${t.fullPerLanded === null ? 'n/a' : t.fullPerLanded.toFixed(2)}`,
    `full-check wall time: ${h(t.fullMs)}; check:changed wall time: ${h(t.changedMs)} (${t.changedRuns} runs)`,
    t.gateWaitMs === null
      ? 'gate wait: no record carries gateWaitMs (added by WP-953; later runs have it)'
      : `gate wait: ${h(t.gateWaitMs)} summed over the runs`,
  ];
  return lines.join('\n');
}

function readEvents(dir) {
  const texts = new Map();
  if (!existsSync(dir)) return texts;
  for (const f of readdirSync(dir))
    if (f.endsWith('.log')) texts.set(f.slice(0, -4), readFileSync(join(dir, f), 'utf8'));
  return texts;
}

function main(argv) {
  const arg = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const since = arg('--since') ? new Date(arg('--since')) : today;
  const until = arg('--until') ? new Date(arg('--until')) : undefined;
  const root = resolve(rawDir(), '..', '..');
  const report = checkCost({
    steps: readJsonl('check-steps.jsonl'),
    tests: readJsonl('tests.jsonl'),
    events: parseEvents(readEvents(join(root, 'work', 'events'))),
    since,
    until,
  });
  console.log(`window: ${since.toISOString()} .. ${until ? until.toISOString() : 'now'}`);
  console.log(formatCheckCost(report));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main(process.argv.slice(2)));
