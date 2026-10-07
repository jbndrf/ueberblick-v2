// WP-1023: where agents wait. Two report rows: e2e runs (metrics/raw/e2e-runs.jsonl, written by scripts/e2e/run.mjs) and
// land latency (review PASS -> merged, from work/events/<WP>.log).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { eventLines, parseWp } from './flow.mjs';
import { pct, sum } from './lib.mjs';

const HOUR = 3_600_000;
const sec = (ms) => `${Math.round(ms / 1000)} s`;
const min = (ms) => (ms / 60_000).toFixed(1);

/** Cells [metric, value]: all runs of the last 24 h, then one cell per caller and mode. Empty without runs. */
export function e2eRunRows(runs, now = new Date()) {
  const recent = runs.filter((r) => now >= new Date(r.at) && now - new Date(r.at) <= 24 * HOUR);
  if (!recent.length) return [];
  const line = (rs) => {
    const wall = rs.map((r) => r.wallMs ?? 0);
    const red = rs.filter((r) => r.exitCode !== 0);
    const infra = rs.filter((r) => r.infra).length;
    return `${rs.length} runs, ${min(sum(wall))} min total, wall p50 ${sec(pct(wall, 50))} / p90 ${sec(pct(wall, 90))}, gate wait ${min(sum(rs.map((r) => r.gateWaitMs)))} min, ${red.length} red${infra ? ` (${infra} infra)` : ''}`;
  };
  const groups = Object.groupBy(recent, (r) => `${r.caller ?? '?'} / ${r.mode ?? '?'}`);
  return [
    ['e2e runs (24 h)', line(recent)],
    ...Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, rs]) => [`  ${k}`, line(rs)]),
  ];
}

/**
 * Per WP that has a `merged` event in the 7 days before `now`: ms from its last `review n PASS` before the merge to the
 * merge, and whether a `refused` line sits between them. `wps`: `{ id, events: [{ at: Date, event }] }`. A WP that passed
 * review and has no merge yet is counted apart.
 */
export function landLatency(wps, now = new Date()) {
  const merged = [];
  let unmerged = 0;
  for (const w of wps) {
    const ev = [...w.events].sort((a, b) => a.at - b.at);
    const end = ev.findLast((e) => e.event === 'merged');
    const pass = ev.findLast((e) => /^review \d+ pass$/.test(e.event) && (!end || e.at <= end.at));
    if (!pass) continue;
    if (!end) {
      unmerged++;
      continue;
    }
    if (end.at > now || now - end.at > 7 * 24 * HOUR) continue;
    const between = ev.filter((e) => e.at >= pass.at && e.at <= end.at);
    merged.push({
      id: w.id,
      ms: end.at - pass.at,
      refused: between.some((e) => /^(refused|reverted) /.test(e.event)),
    });
  }
  return { merged, unmerged };
}

/** Cells [metric, value] for land latency (7 days); empty without merged WPs. */
export function landLatencyRows(wps, now = new Date()) {
  const { merged, unmerged } = landLatency(wps, now);
  if (!merged.length) return [];
  const ms = merged.map((m) => m.ms);
  const h = (x) => (x / HOUR).toFixed(1);
  const refused = merged.filter((m) => m.refused).length;
  return [
    [
      'land latency (7 days)',
      `${merged.length} WPs, last review PASS to merged p50 ${h(pct(ms, 50))} h / p90 ${h(pct(ms, 90))} h, refused at least once on the way ${refused} (${Math.round((100 * refused) / merged.length)}%)${unmerged ? `, ${unmerged} passed review and are not merged yet` : ''}`,
    ],
  ];
}

/** `{ id, events }` for every `work/events/*.log` of `repo` (committed plus pending lines, as the flow metric reads them). */
export function loadLandEvents(repo = '.') {
  let names = [];
  try {
    names = readdirSync(join(repo, 'work', 'events')).filter((n) => n.endsWith('.log'));
  } catch {
    return [];
  }
  return names.map((n) => {
    const id = n.replace(/\.log$/, '');
    return { id, events: parseWp(`## Log\n${eventLines(id, repo).join('\n')}`).events };
  });
}
