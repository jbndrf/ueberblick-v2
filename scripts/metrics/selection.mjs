#!/usr/bin/env node
// WP-1006: why scoped test runs (agents' `check:changed`) ran what they ran. Reads `selection` from the `scoped`
// rows of metrics/raw/tests.jsonl. A blanket run is one that ran every test.
//   npm run -s metrics:selection [--hours N]     (default 24)
import { fileURLToPath } from 'node:url';
import { readJsonl, ratio } from './lib.mjs';

const MIN = 60_000;
/** The reason shown for scoped rows recorded before the selection field existed. */
export const UNRECORDED = 'unrecorded';

/**
 * @param {object[]} rows tests.jsonl rows
 * @param {{ hours?: number, now?: number }} [opts] window in hours back from `now` (epoch ms)
 */
export function summarize(rows, { hours = 24, now = Date.now() } = {}) {
  const from = now - hours * 3_600_000;
  const scoped = rows.filter(
    (r) => r.kind === 'scoped' && (hours === Infinity || new Date(r.at).getTime() >= from),
  );
  const groups = new Map();
  let blanket = 0;
  let blanketMs = 0;
  let scopedMs = 0;
  for (const r of scoped) {
    const ms = r.wallMs ?? 0;
    const isAll = r.selection?.all === true;
    const reason = r.selection ? (r.selection.reason ?? 'unknown') : UNRECORDED;
    scopedMs += ms;
    if (isAll) {
      blanket++;
      blanketMs += ms;
    }
    const g = groups.get(reason) ?? { reason, blanket: isAll, count: 0, minutes: 0, branches: new Set() };
    g.count++;
    g.minutes += ms / MIN;
    g.branches.add(r.branch ?? '?');
    groups.set(reason, g);
  }
  return {
    scoped: scoped.length,
    blanket,
    blanketShare: scoped.length ? blanket / scoped.length : 0,
    blanketMinutes: blanketMs / MIN,
    scopedMinutes: scopedMs / MIN,
    byReason: [...groups.values()]
      .map((g) => ({ ...g, branches: [...g.branches].sort() }))
      .sort((a, b) => b.minutes - a.minutes || b.count - a.count),
  };
}

/** At most 4 branch names, then the count of the rest. */
const branchList = (b) => (b.length > 4 ? `${b.slice(0, 4).join(', ')} +${b.length - 4}` : b.join(', '));
const fmtMin = (m) => `${m.toFixed(1)} min`;

/** One line for `npm run metrics`. */
export const summaryLine = (s, hours) =>
  `scoped runs (last ${hours} h): ${s.scoped}, blanket (every test) ${s.blanket} (${ratio(s.blanket, s.scoped)}), ${fmtMin(s.blanketMinutes)} of ${fmtMin(s.scopedMinutes)}` +
  (s.byReason.find((r) => r.blanket) ? `; top reason: ${s.byReason.find((r) => r.blanket).reason}` : '');

export function render(s, hours) {
  const out = [
    `Scoped test runs, last ${hours} h: ${s.scoped} scoped runs`,
    `Blanket runs (every test): ${s.blanket} of ${s.scoped} (${ratio(s.blanket, s.scoped)})`,
    `Agent-minutes in blanket runs: ${fmtMin(s.blanketMinutes)} of ${fmtMin(s.scopedMinutes)} (${ratio(s.blanketMinutes, s.scopedMinutes)})`,
  ];
  if (!s.byReason.length) return out.join('\n');
  out.push(
    '',
    'By reason (most minutes first; * = every test):',
    '| count | minutes | branches | reason |',
    '|---|---|---|---|',
  );
  for (const g of s.byReason)
    out.push(
      `| ${g.count} | ${g.minutes.toFixed(1)} | ${branchList(g.branches)} | ${g.blanket ? '* ' : ''}${g.reason} |`,
    );
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--hours');
  const hours = at >= 0 ? Number(process.argv[at + 1]) || 24 : 24;
  console.log(render(summarize(readJsonl('tests.jsonl'), { hours }), hours));
}
