// Budget helpers for the benchmarks (docs/12-performance-budgets.md). Plain ESM so the CLI can use it
// without a TypeScript step; types are in budget.d.mts.
import { appendFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';

/** CPU slowdown of the docs/12 reference phone against the machine that runs the benchmarks. */
export const DEVICE_FACTOR = 4;

/** How a value was measured: x4 = on this machine, scaled by DEVICE_FACTOR before it meets a device budget;
 * server = server code, compared as measured; dev-only = desktop tooling (builder), compared as measured and
 * proves no docs/12 device row; measured = already on the device profile (browser bench) or not a time. */
export const DEVICES = Object.freeze(['x4', 'server', 'dev-only', 'measured']);
/** Where main-thread-sensitive work runs. Required for x4 budgets. */
export const THREADS = Object.freeze(['main', 'worker', 'n/a']);
const TIME_UNITS = new Set(['ms', 's']);

const row = (id, limit, unit, device) => [id, { id, row: id, limit, unit, device }];

// The rows of docs/12. Device rows default to `measured`: the browser bench proves them on the device profile.
// A node benchmark that stands in for a row passes docBudget(row, {device: 'x4', thread}).
const DOC_ROWS = Object.fromEntries([
  row('shell-js-gzip', 250, 'KB', 'measured'),
  row('cold-start-60k', 5, 's', 'measured'),
  row('warm-start-map', 3, 's', 'measured'),
  row('long-task', 100, 'ms', 'measured'),
  row('interaction-to-next-paint', 200, 'ms', 'measured'),
  row('heap-60k', 150, 'MB', 'measured'),
  row('delta-visible', 1, 's', 'measured'),
  row('offline-copy-60k', 30, 's', 'measured'),
  row('server-idle-rss', 120, 'MB', 'server'),
  row('run-endpoint-p95', 50, 'ms', 'server'),
  row('empty-delta-p95', 10, 'ms', 'server'),
  row('snapshot-60k', 20, 's', 'server'),
  row('bbox-query-p95', 100, 'ms', 'server'),
  row('filter-change-60k', 100, 'ms', 'server'),
]);

/**
 * A budget is one upper limit. It names the docs/12 row it is (`row`) or says how its limit derives from one
 * (`derivedFrom`, free text that names the row), and how the value was measured (`device`).
 * @param {{id: string, limit: number, unit: string, row?: string, derivedFrom?: string, device: string, thread?: string}} b
 */
export function defineBudget(b) {
  if (!b.row && !b.derivedFrom) throw new Error(`budget ${b.id}: needs a docs/12 row or derivedFrom`);
  if (b.row && !(b.row in DOC_ROWS)) throw new Error(`budget ${b.id}: "${b.row}" is not a docs/12 row`);
  if (!DEVICES.includes(b.device))
    throw new Error(`budget ${b.id}: device must be one of ${DEVICES.join(', ')}`);
  if (b.thread !== undefined && !THREADS.includes(b.thread))
    throw new Error(`budget ${b.id}: unknown thread`);
  if (b.device === 'x4' && b.thread === undefined)
    throw new Error(`budget ${b.id}: an x4 budget states its thread`);
  return Object.freeze({ ...b });
}

/** The budget table of docs/12, one entry per row. Every budget is an upper limit. */
export const DOC_BUDGETS = Object.freeze(
  Object.fromEntries(Object.entries(DOC_ROWS).map(([id, b]) => [id, Object.freeze({ ...b })])),
);

/**
 * A docs/12 row, measured another way than its default (id, limit and unit stay the row's unless `id` is given).
 * @param {string} rowId @param {{device?: string, thread?: string, id?: string}} [how]
 */
export function docBudget(rowId, how = {}) {
  const base = DOC_ROWS[rowId];
  if (!base) throw new Error(`"${rowId}" is not a docs/12 row`);
  return defineBudget({ ...base, ...how });
}

/** The factor that turns a measured value into the value the budget is compared against. */
export function factorOf(budget) {
  return budget.device === 'x4' && TIME_UNITS.has(budget.unit) ? DEVICE_FACTOR : 1;
}

/** @param {{id: string, limit: number, unit: string, device: string}} budget @param {number} value */
export function evaluate(budget, value) {
  const adjusted = value * factorOf(budget);
  // a reported line goes through here again: its own value, adjusted and pass are replaced
  return { ...budget, value, adjusted, pass: adjusted <= budget.limit };
}

/**
 * Load per core (1-minute load average / cores) above which a breach is `UNRELIABLE`, not a failure: the machine
 * is shared and time values are inflated (WP-153).
 */
export const VERDICTS = Object.freeze(['PASS', 'FAIL', 'UNRELIABLE']);
export const LOAD_LIMIT_PER_CORE = 0.5;
export const loadLimit = () => LOAD_LIMIT_PER_CORE;
/** A value above HARD_FACTOR x its limit is a FAIL at any load: load does not explain a doubling. */
export const HARD_FACTOR = 2;

/** Load per core now. `BENCH_LOAD_PER_CORE` pins it (harness tests). */
export function machineLoad() {
  const pinned = process.env.BENCH_LOAD_PER_CORE;
  if (pinned !== undefined && pinned !== '') return Number(pinned);
  return loadavg()[0] / availableParallelism();
}

/**
 * PASS within the limit. FAIL above HARD_FACTOR x the limit at any load, and FAIL above the limit on a quiet
 * machine (load per core at most LOAD_LIMIT_PER_CORE). UNRELIABLE above the limit while the machine was busy:
 * rerun quiet. `strict` (`--strict`, BENCH_STRICT=1: the phase-end report) counts UNRELIABLE as FAIL.
 * A line without a load is judged as measured.
 * @param {{pass: boolean, adjusted: number, limit: number, unit: string, load?: number}} line
 * @param {number | undefined} [load] @param {boolean} [strict]
 */
export function verdictOf(line, load = line.load, strict = false) {
  if (line.pass) return 'PASS';
  if (strict || line.adjusted > line.limit * HARD_FACTOR) return 'FAIL';
  // only time values are inflated by load; a size (KB, MB, bytes) is the same on a busy machine
  if (!TIME_UNITS.has(line.unit)) return 'FAIL';
  return load !== undefined && load > loadLimit() ? 'UNRELIABLE' : 'FAIL';
}

/** True under `--strict` / BENCH_STRICT=1 (the phase-end report): UNRELIABLE counts as FAIL. */
export const strictMode = () => process.env.BENCH_STRICT === '1';

/**
 * The one way a benchmark judges a timing budget (WP-913). Takes the line `report()` returned and applies
 * `verdictOf` with the load it was measured under: FAIL throws (with the formatted line), UNRELIABLE and PASS
 * return. Never `expect(ms).toBeLessThan(limit)` in a bench: a raw assert ignores load.
 * @param {Parameters<typeof verdictOf>[0] & Parameters<typeof formatLine>[0]} line @param {boolean} [strict]
 */
export function assertBudget(line, strict = strictMode()) {
  const verdict = verdictOf(line, line.load, strict);
  if (verdict === 'FAIL') throw new Error(`budget exceeded: ${formatLine(line, strict)}`);
  return verdict;
}

const round = (n) => Math.round(n * 1000) / 1000;

/** @param {ReturnType<typeof evaluate>} line @param {boolean} [strict] */
export function formatLine(line, strict = false) {
  const factor =
    line.adjusted === line.value ? '' : ` (x${DEVICE_FACTOR}: ${round(line.adjusted)} ${line.unit})`;
  const how = [line.device, line.thread].filter(Boolean).join(', ');
  const load = line.load === undefined ? '' : `  load ${round(line.load)}/core`;
  return `bench ${line.id}: ${line.value} ${line.unit}${factor} / ${line.limit} ${line.unit}  ${verdictOf(line, line.load, strict)}  [${how}]${load}`;
}

/**
 * A benchmark reports one measured value against its budget. Under `npm run bench` the line is collected
 * through the file named by BENCH_REPORT; it is always printed.
 * @param {{id: string, limit: number, unit: string, device: string}} budget @param {number} value
 */
export function report(budget, value) {
  const line = { ...evaluate(budget, value), load: Math.round(machineLoad() * 100) / 100 };
  console.log(formatLine(line));
  const file = process.env.BENCH_REPORT;
  if (file) appendFileSync(file, JSON.stringify(line) + '\n');
  return line;
}
