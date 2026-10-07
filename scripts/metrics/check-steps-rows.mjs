// Report rows for check step timings (metrics/raw/check-steps.jsonl, written by scripts/ops/steps.mjs, WP-930).
import { pct } from './lib.mjs';

const sec = (ms) => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);

/** One row per suite and per step: [name, runs, p50, p90, red, median load1]. Empty without entries. */
export function checkStepsRows(entries) {
  if (!entries.length) return [];
  const rows = [];
  const add = (name, xs) =>
    rows.push([
      name,
      `${xs.length}`,
      sec(
        pct(
          xs.map((x) => x.ms),
          50,
        ),
      ),
      sec(
        pct(
          xs.map((x) => x.ms),
          90,
        ),
      ),
      `${xs.filter((x) => x.exit !== 0).length}`,
      `${
        pct(
          xs.map((x) => x.load1 ?? 0),
          50,
        ) ?? 'n/a'
      }`,
    ]);
  for (const [suite, es] of Object.entries(Object.groupBy(entries, (e) => e.suite)))
    add(
      `suite ${suite}`,
      es.map((e) => ({ ms: e.wallMs, exit: e.exitCode, load1: e.load1 })),
    );
  const steps = entries.flatMap((e) => (e.steps ?? []).map((s) => ({ ...s, load1: e.load1 })));
  for (const [name, ss] of Object.entries(Object.groupBy(steps, (s) => s.name))) add(name, ss);
  return rows;
}
