// Report rows for e2e triage (metrics/raw/e2e.jsonl, written by scripts/e2e-triage).
import { sum, fmtK } from './lib.mjs';

/** Table cells [metric, value]; empty without entries. */
export function e2eRows(all) {
  // main-watch rows (scripts/e2e/main-watch.mjs, WP-978) carry no triage fields: summarized apart.
  const entries = all.filter((e) => e.kind !== 'main-watch');
  const watch = all.filter((e) => e.kind === 'main-watch');
  const last = watch.at(-1);
  const watchRows = last
    ? [
        [
          'e2e on main (last run)',
          `${String(last.sha).slice(0, 7)}: ${last.passed} passed, ${last.failed} failed (${watch.length} runs)`,
        ],
      ]
    : [];
  if (!entries.length) return watchRows;
  const byClass = {};
  for (const e of entries)
    for (const [k, n] of Object.entries(e.byClass ?? {})) byClass[k] = (byClass[k] ?? 0) + n;
  const tok = (k) => fmtK(sum(entries.map((e) => e.tokens?.[k])));
  return [
    ['e2e triage runs', `${entries.length}`],
    [
      'failures classified',
      `${sum(entries.map((e) => e.failures))}: ${
        Object.entries(byClass)
          .map(([k, n]) => `${k} ${n}`)
          .join(', ') || '-'
      }`,
    ],
    ['local model tokens in / out / image', `${tok('in')} / ${tok('out')} / ${tok('image')}`],
    ['model time', `${Math.round(sum(entries.map((e) => e.ms)) / 1000)} s`],
    ...watchRows,
  ];
}
