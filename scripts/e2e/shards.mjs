// One suite as several Playwright processes at once (WP-1009). Each shard is `playwright test --shard=i/K` with its own
// server (own port and data dir), so no spec shares state with a spec of another shard; inside a shard files stay serial.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';

/** Default parallelism: min(4, cores / 8), at least 1. */
export function defaultShards(cores = availableParallelism()) {
  return Math.max(1, Math.min(4, Math.floor(cores / 8)));
}

/**
 * How many shards run at once: `UEB_E2E_WORKERS` (or `E2E_WORKERS`) when a positive integer, else the default.
 * `UEB_E2E_WORKERS=1` runs every suite as one plain Playwright process, for debugging.
 */
export function shardCount(env = process.env, cores = availableParallelism()) {
  const raw = env['UEB_E2E_WORKERS'] ?? env['E2E_WORKERS'];
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isInteger(n) && n > 0 ? n : defaultShards(cores);
}

const STAT_KEYS = ['expected', 'unexpected', 'flaky', 'skipped'];

/** Merges the JSON reports of the shards of one suite into one report, the shape triage and `collectFailures` read. */
export function mergeReports(reports) {
  if (reports.length === 0) throw new Error('mergeReports: no report');
  const first = reports[0];
  const stats = { ...first.stats };
  for (const k of STAT_KEYS) stats[k] = reports.reduce((n, r) => n + (r.stats?.[k] ?? 0), 0);
  stats.startTime =
    reports
      .map((r) => r.stats?.startTime)
      .filter(Boolean)
      .sort()[0] ?? first.stats?.startTime;
  stats.duration = Math.max(...reports.map((r) => r.stats?.duration ?? 0));
  return {
    ...first,
    suites: reports.flatMap((r) => r.suites ?? []),
    errors: reports.flatMap((r) => r.errors ?? []),
    stats,
  };
}

/**
 * Per file of one Playwright JSON report: `{ [file]: { ms, tests } }`. `ms` sums every result (retries too) of every
 * test of the file; `tests` counts the tests (one per project). A `--list` report has no results, so ms is 0.
 */
export function fileStats(report) {
  const out = {};
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      const e = (out[spec.file] ??= { ms: 0, tests: 0 });
      for (const t of spec.tests ?? []) {
        e.tests += 1;
        for (const r of t.results ?? []) e.ms += r.duration ?? 0;
      }
    }
    for (const s of suite.suites ?? []) visit(s);
  };
  for (const s of report.suites ?? []) visit(s);
  return out;
}

/** The history `{ [file]: ms }` after a run: files the run saw take its duration, the others keep theirs. */
export function mergeHistory(history, stats) {
  const next = { ...history };
  for (const [file, s] of Object.entries(stats)) next[file] = s.ms;
  return next;
}

/** Per-file durations of a suite, `{}` when there is none (first run, unreadable file). */
export function loadHistory(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

export function saveHistory(path, history) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.${process.pid}`, JSON.stringify(history));
  renameSync(`${path}.${process.pid}`, path);
}

/**
 * Splits `counts` (`{ [file]: tests }`) into at most `k` shards of similar duration: greedy, longest file first into the
 * lightest shard. A file's weight is its recorded duration in `history`; a file the history lacks weighs the mean
 * recorded file; with no history at all every file weighs its test count. Empty shards are dropped, files inside a
 * shard are sorted by name, so the plan is deterministic.
 */
export function balanceShards(counts, history, k) {
  const known = Object.keys(counts).filter((f) => Number.isFinite(history[f]));
  const mean = known.length ? known.reduce((n, f) => n + history[f], 0) / known.length : 0;
  const weight = (f) => (known.length === 0 ? counts[f] : Number.isFinite(history[f]) ? history[f] : mean);
  const files = Object.keys(counts).sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1));
  const bins = Array.from({ length: Math.min(k, files.length) }, () => ({ w: 0, files: [] }));
  for (const f of files) {
    const bin = bins.reduce((m, b) => (b.w < m.w ? b : m));
    bin.w += weight(f);
    bin.files.push(f);
  }
  return bins.map((b) => b.files.sort());
}

/** `limit(fn)` runs `fn` once fewer than `n` earlier calls are running; waiting calls start in call order. */
export function createLimiter(n) {
  let live = 0;
  const waiting = [];
  const next = () => {
    if (live >= n || waiting.length === 0) return;
    live++;
    waiting.shift()();
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      waiting.push(() =>
        fn()
          .then(resolve, reject)
          .finally(() => {
            live--;
            next();
          }),
      );
      next();
    });
}

/** The path filter that selects exactly one spec file (Playwright matches the argument as a regex on the full path). */
export const filePattern = (file) => `/${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;

/** `--shard=i/K` argument for shard `i` (0-based). */
export const shardArg = (i, k) => `--shard=${i + 1}/${k}`;

/**
 * Runs the shards of one suite and writes the merged JSON report to `reportPath`. Resolves to 0 when every shard
 * passed. With `shardFiles` (one file list per shard, from `balanceShards`) shard i runs exactly its files; without,
 * `k` shards split by Playwright's `--shard`. `shardEnvs[i]` holds the port and data-dir vars of shard i, else
 * `renewEnv(i)` makes them when the shard starts; `renewEnv(i)` also gives fresh ones for the retry of a shard whose
 * port was taken. `limit` (a `createLimiter`) caps the shard processes of several suites running at once, `name`
 * prefixes the log lines; `spawnShard` is injectable for tests.
 */
export async function runShards({
  config,
  k = 1,
  shardFiles,
  shardEnvs,
  passthrough,
  env,
  tmpDir,
  reportPath,
  cwd,
  renewEnv,
  limit = (fn) => fn(),
  name = '',
  spawnShard = spawnPlaywright,
}) {
  const outputs = [];
  const n = shardFiles ? shardFiles.length : k;
  const codes = await Promise.all(
    Array.from({ length: n }, (_, i) => {
      const out = join(tmpDir, `report-${i}.json`);
      outputs.push(out);
      const args = [
        'playwright',
        'test',
        '-c',
        config,
        ...(shardFiles ? [] : [shardArg(i, k)]),
        '--reporter=list,json',
        '--pass-with-no-tests',
        `--output=${join(tmpDir, `artifacts-${i}`)}`,
        ...passthrough,
        ...(shardFiles ? shardFiles[i].map(filePattern) : []),
      ];
      let first;
      const envOf = async (attempt) => {
        if (attempt === 1) first ??= shardEnvs?.[i] ?? (await renewEnv(i));
        return { ...env, ...(attempt === 1 ? first : await renewEnv(i)), PLAYWRIGHT_JSON_OUTPUT_NAME: out };
      };
      const label = `${name ? `${name} ` : ''}shard ${i + 1}`;
      return limit(() => spawnWithRetry(spawnShard, args, envOf, cwd, label));
    }),
  );
  const reports = [];
  for (const out of outputs) {
    try {
      reports.push(JSON.parse(readFileSync(out, 'utf8')));
    } catch {
      // a shard that crashed before writing its report: its exit code already fails the suite
    }
  }
  if (reports.length > 0) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(mergeReports(reports)));
  }
  return codes.every((c) => c === 0) ? 0 : 1;
}

/**
 * Runs one Playwright process; when it fails because its server port was taken (the OS-chosen port is free when picked,
 * not reserved), runs it once more with `envOf(2)`. `envOf(attempt)` returns the env; resolves to the exit code.
 */
export async function spawnWithRetry(spawnShard, args, envOf, cwd, label, tries = 2) {
  for (let attempt = 1; ; attempt++) {
    const r = await spawnShard(args, await envOf(attempt), cwd, label);
    if (r.code === 0 || !r.portTaken || attempt >= tries) return r.code;
    process.stderr.write(`[${label}] server port was taken, retrying with a new port\n`);
  }
}

const PORT_TAKEN = /is already used, make sure that nothing is running|Port \d+ is already in use|EADDRINUSE/;

/** Spawns `npx <args>` with every output line prefixed by `[label]`; resolves `{ code, portTaken }`. */
export function spawnPlaywright(args, env, cwd, label) {
  return new Promise((resolve) => {
    const child = spawn('npx', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let portTaken = false;
    const pipe = (stream, sink) => {
      let rest = '';
      const out = (l) => {
        if (PORT_TAKEN.test(l)) portTaken = true;
        sink.write(`[${label}] ${l}\n`);
      };
      stream.on('data', (d) => {
        const lines = (rest + d).split('\n');
        rest = lines.pop() ?? '';
        lines.forEach(out);
      });
      stream.on('end', () => rest && out(rest));
    };
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);
    child.on('close', (code) => resolve({ code: code ?? 1, portTaken }));
  });
}

/** Playwright flags that take the next argument as their value (so that argument is not a file filter). */
const VALUE_FLAGS = new Set([
  '-c',
  '--config',
  '-g',
  '--grep',
  '-G',
  '--grep-invert',
  '--project',
  '--repeat-each',
  '--retries',
  '-j',
  '--workers',
  '--timeout',
  '--global-timeout',
  '--reporter',
  '--output',
  '--shard',
  '--max-failures',
  '--trace',
]);

/**
 * True when Playwright args name test files (positional filters). Sharded runs pass each shard's files as positional
 * patterns, and Playwright ORs positional patterns, so a file filter there would run the whole suite: such a run goes
 * plain instead (one process; a targeted run is small anyway).
 */
export function hasFileFilters(args) {
  return args.some((a, i) => !a.startsWith('-') && !VALUE_FLAGS.has(args[i - 1] ?? ''));
}
