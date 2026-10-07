// Turns the lines that benchmarks reported into the result of one `npm run bench` (docs/process/metrics.md).
import { evaluate, verdictOf } from './budget.mjs';

/**
 * Keeps the last value per id, in order of first report, and re-evaluates it against its limit. A breach
 * taken on a busy machine (`load` per core) is `UNRELIABLE` and does not fail the run (WP-153); over HARD_FACTOR x the limit, or in `strict` mode, it fails.
 * @param {{id: string, value: number, limit: number, unit: string}[]} reported
 */
export function summarise(reported, strict = false) {
  const byId = new Map();
  for (const r of reported) byId.set(r.id, r);
  const lines = [...byId.values()].map((r) => evaluate(r, r.value));
  return { lines, ok: lines.every((l) => verdictOf(l, l.load, strict) !== 'FAIL') };
}
