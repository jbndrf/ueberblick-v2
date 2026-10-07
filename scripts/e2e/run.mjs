// `npm run e2e`: builds apps/web once, runs every configured and discovered component suite (WP-554.4, WP-951); a missing config fails the run. `--affected <base>`: WP-1019.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enforceRepeatCap } from './repeat-cap.mjs';
import { installReaper } from './server-reap.mjs';
import { scopedTmp } from '../ops/vitest-scoped.mjs';
import { prepareBuild } from '../ops/web-build.mjs';
import { PARAGLIDE_COMPILE, PARAGLIDE_DONE_VAR } from './component-config.mjs';
import { fileFilter, judgeAffected, mergeResults, startAffected, testCounts } from './affected-plan.mjs';
import { discoverSuites, portEnvFor } from './discover.mjs';
import { modeOf, startRecording, summarizeReports } from './run-record.mjs';
import {
  balanceShards,
  hasFileFilters,
  createLimiter,
  fileStats,
  filePattern,
  loadHistory,
  mergeHistory,
  runShards,
  saveHistory,
  shardCount,
} from './shards.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Every e2e suite, in run order. Add a suite here and nowhere else (triage imports it, WP-911).
 * `report` is the Playwright JSON report the suite's config writes, relative to the repo root.
 */
export const SUITES = Object.freeze([
  {
    id: 'apps-web',
    name: 'apps/web',
    config: 'apps/web/playwright.config.ts',
    report: 'apps/web/test-results/e2e-report.json',
  },
  {
    id: 'a11y',
    name: 'e2e/a11y',
    config: 'e2e/a11y/playwright.config.ts',
    report: 'apps/web/test-results/e2e-a11y-report.json',
  },
  {
    id: 'participant',
    name: 'e2e/participant',
    config: 'e2e/participant/playwright.config.ts',
    report: 'apps/web/test-results/e2e-participant-report.json',
  },
  {
    id: 'journeys',
    name: 'e2e/journeys',
    config: 'e2e/journeys/playwright.config.ts',
    report: 'apps/web/test-results/e2e-journeys-report.json',
  },
]);

/** The fixed suites plus every discovered component suite (a playwright.config.ts in an `e2e` dir under packages/<pkg>/src, WP-951). */
export function allSuites(root = ROOT) {
  return [...SUITES, ...discoverSuites(root)];
}

/**
 * Splits argv into `--suite <id>` / `--suite=<id>` selections and the arguments that pass through to Playwright.
 * `--suite` may repeat; ids are the `id` of a SUITES entry.
 */
export function parseArgs(argv) {
  const names = [];
  const rest = [];
  let affected;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--affected') affected = argv[++i] ?? '';
    else if (a === '--suite') {
      const v = argv[++i];
      if (v === undefined) throw new Error('e2e: --suite needs a name');
      names.push(v);
    } else if (a.startsWith('--suite=')) names.push(a.slice('--suite='.length));
    else rest.push(a);
  }
  if (affected === '') throw new Error('e2e: --affected needs a base commit');
  return affected === undefined ? { names, rest } : { names, rest, affected };
}

/**
 * The suites named by `names` (in run order, once each); no names selects all. `components` names every
 * discovered component suite. An unknown name is an error.
 */
export function selectSuites(suites, names) {
  const isComp = (s) => s.id.startsWith('comp:');
  const unknown = names.filter((n) => n !== 'components' && !suites.some((s) => s.id === n));
  if (unknown.length > 0)
    throw new Error(
      `e2e: unknown suite ${unknown.join(', ')} (known: ${[...suites.map((s) => s.id), 'components'].join(', ')})`,
    );
  if (names.length === 0) return [...suites];
  return suites.filter((s) => names.includes(s.id) || (names.includes('components') && isComp(s)));
}

/**
 * The env vars each playwright config reads for its server port and data dir (WP-925). Order: apps/web, a11y,
 * participant, journeys. No `UEB_` prefix: specEnv strips that. The configs fall back to fixed constants when unset (single run only).
 */
export const PORT_VARS = Object.freeze([
  { port: 'E2E_PORT', dir: 'E2E_DATA_DIR', name: 'flow' },
  { port: 'E2E_A11Y_PORT', dir: 'E2E_A11Y_DATA_DIR', name: 'a11y' },
  { port: 'E2E_PARTICIPANT_PORT', dir: 'E2E_PARTICIPANT_DATA_DIR', name: 'participant' },
  { port: 'E2E_JOURNEYS_PORT', dir: 'E2E_JOURNEYS_DATA_DIR', name: 'journeys' },
]);

/** The port and data-dir env vars one suite's config reads: the fixed list, or one pair derived from a component id. */
export function varsFor(suite) {
  return suite.id?.startsWith('comp:') ? [{ ...portEnvFor(suite.id), name: 'comp' }] : PORT_VARS;
}

/** `n` distinct free ports (all listeners stay open until every port is known). Not reserved until Playwright binds: a rare collision is fixed by a rerun. */
export async function freePorts(n) {
  const servers = [];
  try {
    for (let i = 0; i < n; i++) {
      const srv = createServer();
      await new Promise((resolve, reject) => {
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', resolve);
      });
      servers.push(srv);
    }
    return servers.map((s) => s.address().port);
  } finally {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  }
}

/**
 * One env per suite with a distinct port and a private data dir for every server that suite may start.
 * `ports` needs `varsFor(suite).length` entries per suite, in order; data dirs are created under `base`.
 */
export function assignRun(suites, base, ports) {
  let next = 0;
  return suites.map((suite) => {
    const env = {};
    for (const v of varsFor(suite)) {
      const dir = join(base, `${suite.name.replace(/[^a-z0-9]+/gi, '-')}-${v.name}`);
      mkdirSync(dir, { recursive: true });
      env[v.port] = String(ports[next++]);
      env[v.dir] = dir;
    }
    return { suite, env };
  });
}

/** Suites whose config file does not exist under `root`. */
export function missingSuites(suites, root, exists = existsSync) {
  return suites.filter((s) => !exists(join(root, s.config)));
}

/**
 * Runs the suites in order (`run` may return a promise) and keeps going after a failure so one run reports them all.
 * Returns `{ ok, failed, missing }`; a missing config counts as a failure.
 */
export async function runSuites(suites, root, run, exists = existsSync) {
  const missing = missingSuites(suites, root, exists).map((s) => s.name);
  const failed = [...missing];
  for (const s of suites) {
    if (missing.includes(s.name)) continue;
    if ((await run(s)) !== 0) failed.push(s.name);
  }
  return { ok: failed.length === 0, failed, missing };
}

/** Marks a run that already went through the e2e gate pool (WP-1016), so run.mjs does not queue itself again. */
export const GATED_VAR = 'UEB_E2E_GATED';

/**
 * The command that runs this script under an e2e slot of scripts/ops/check-gate.sh (build included), or null when
 * it already did. A nested call under a held slot passes the gate at once (UEB_GATE_HELD, see the gate's header).
 */
export function gateCommand(argv, env = process.env, root = ROOT) {
  if (env[GATED_VAR] === '1') return null;
  return {
    command: 'bash',
    args: [
      join(root, 'scripts/ops/check-gate.sh'),
      '--e2e',
      process.execPath,
      fileURLToPath(import.meta.url),
      ...argv,
    ],
    env: { ...env, [GATED_VAR]: '1' },
  };
}

/** Playwright's headless Chromium needs system libraries in some sandboxes: the bench setup provides them. */
async function browserEnv() {
  const { chromium } = await import('playwright-core');
  const { ensureLibs } = await import('../../bench/browser/lib/libs.mjs');
  const full = chromium.executablePath();
  const version = full.split('/').at(-4).replace('chromium-', '');
  const shell = join(
    dirname(dirname(dirname(dirname(full)))),
    `chromium_headless_shell-${version}`,
    'chrome-headless-shell-linux64',
    'chrome-headless-shell',
  );
  const exe = existsSync(shell) ? shell : full;
  if (!existsSync(exe)) throw new Error('Chromium is missing: run `npx playwright install chromium`');
  return { ...process.env, ...ensureLibs(exe) };
}

// async on purpose (WP-1030): a blocking spawnSync would hold back the reaper's signal handlers
function sh(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', env });
    child.on('error', () => resolve(1)).on('close', (code) => resolve(code ?? 1));
  });
}

/** Suites that run alone, plain, after the others because they are flaky beside them. `id -> measured reason` (WP-1016). */
export const RUN_ALONE = Object.freeze({});

/** Where the per-file durations of a suite are kept: one file per suite under the git common dir, shared by every worktree. */
export function historyPath(suite, root = ROOT) {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: root,
    encoding: 'utf8',
  });
  const base = r.status === 0 ? r.stdout.trim() : join(root, 'apps/web/test-results');
  return join(base, 'e2e-durations', `${suite.id.replace(/[^a-z0-9]+/gi, '-')}.json`);
}

/** `playwright test --list` as a parsed JSON report: the test files of one suite (the config's own testMatch applies). */
function listTests(suite, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['playwright', 'test', '-c', suite.config, '--list', '--reporter=json'], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      try {
        if (code !== 0) throw new Error(err.trim().split('\n').slice(-2).join(' | ') || `exit ${code}`);
        resolve(JSON.parse(out.slice(out.indexOf('{'))));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * The files of a suite dealt to at most `k` shards by recorded duration (count when there is no history), or undefined
 * when the suite cannot be listed: it then falls back to Playwright's `--shard` split by count, and says so.
 * `only` (WP-1019, `--affected`) limits the plan to those files of the suite.
 */
export async function planShards(suite, env, history, k, list = (s, e) => listTests(s, e), only = null) {
  try {
    const counts = testCounts(fileStats(await list(suite, env)), only);
    return balanceShards(counts, history, k);
  } catch (e) {
    console.error(
      `e2e: ${suite.name}: cannot list its tests (${e.message}); splitting by --shard (by count)`,
    );
    return undefined;
  }
}

/** Adds the per-file durations of the suite's merged report to its history. Best effort: a missing report changes nothing. */
function recordDurations(suite) {
  try {
    const file = historyPath(suite);
    const report = JSON.parse(readFileSync(join(ROOT, suite.report), 'utf8'));
    saveHistory(file, mergeHistory(loadHistory(file), fileStats(report)));
  } catch {
    // no report (the suite crashed before writing one): the next run uses the older history
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  enforceRepeatCap(process.argv.slice(2));
  let selected, passthrough;
  let recorder; // WP-1023: one row per run in metrics/raw/e2e-runs.jsonl
  let affected = null; // suite id -> spec files (null: the whole suite) under --affected
  const onlyOf = (s) => affected?.get(s.id) ?? null;
  const filesArgs = (s) => onlyOf(s)?.map(filePattern) ?? [];
  try {
    const parsed = parseArgs(process.argv.slice(2));
    selected = selectSuites(allSuites(), parsed.names);
    passthrough = parsed.rest;
    recorder = startRecording({ mode: modeOf(parsed), suites: selected.length, shards: shardCount() });
    if (parsed.affected !== undefined)
      ({ affected, selected } = startAffected(ROOT, parsed.affected, selected, historyPath, shardCount()));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  installReaper(); // WP-1030: signals and exit take every process below this runner down (servers included)
  const gated = gateCommand(process.argv.slice(2));
  if (gated) {
    recorder.cancel(); // the gated child records the run
    process.exit(await sh(gated.command, gated.args, gated.env));
  }
  const env = await browserEnv();
  await prepareBuild().catch((e) => (console.error(e.message), process.exit(1)));
  // A free port and a private data dir per server and run, so several worktrees can run e2e at once (WP-925).
  // WP-1009/1016: every suite, fixed or component, runs as up to `k` shards with their own servers and data dirs. The
  // shard processes of all suites share one pool of `k` (a suite does not wait for the one before it), and files are
  // dealt to shards by recorded duration (`balanceShards`). UEB_E2E_WORKERS=1 runs plain processes, one suite at a time.
  const t0 = Date.now();
  const tmp = scopedTmp('ueberblick-e2e-');
  const k = shardCount();
  console.log(`e2e: ${k} shard processes at once; UEB_E2E_WORKERS=1 runs one plain process at a time`);
  let copyNo = 0; // a data dir per copy, a retry gets its own too
  const envFor = async (s, copies) =>
    assignRun(
      Array.from({ length: copies }, () => ({ ...s, name: `${s.name}-${++copyNo}` })),
      tmp.dir,
      await freePorts(varsFor(s).length * copies),
    ).map((a) => a.env);
  passthrough = [...fileFilter.args(ROOT, selected, passthrough), ...passthrough];
  const plainArgs = (s) => ['playwright', 'test', '-c', s.config, ...passthrough, ...filesArgs(s)];
  const isComp = (s) => s.id.startsWith('comp:');
  const alone = selected.filter((s) => s.id in RUN_ALONE);
  const pooled = selected.filter((s) => !(s.id in RUN_ALONE));
  const codes = new Map();
  const track = (s, c) => (codes.set(s.name, c), c);
  const plain = (suites) =>
    runSuites(suites, ROOT, async (s) =>
      track(s, await sh('npx', plainArgs(s), { ...env, ...(await envFor(s, 1))[0] })),
    );
  let result;
  if (k === 1) result = await plain(selected);
  else if (hasFileFilters(passthrough)) {
    // a file filter would be ORed with each shard's file list (the whole suite would run): one plain process instead
    console.log('e2e: file filter given, running plain (not sharded)');
    result = await plain(selected);
  } else {
    if (pooled.some(isComp)) {
      // one compile for every web-backed harness: shards compiling at once rewrite the files under each other
      if (spawnSync(PARAGLIDE_COMPILE, { cwd: ROOT, stdio: 'inherit', env, shell: true }).status !== 0)
        process.exit(1);
      env[PARAGLIDE_DONE_VAR] = '1';
    }
    const limit = createLimiter(k);
    const history = (s) => loadHistory(historyPath(s));
    const total = (s) => Object.values(history(s)).reduce((n, ms) => n + ms, 0);
    const order = [...pooled].sort((a, b) => total(b) - total(a)); // longest suites queue first
    const missing = missingSuites(order, ROOT).map((s) => s.name);
    const failed = [...missing];
    await Promise.all(
      order
        .filter((s) => !missing.includes(s.name))
        .map(async (s) => {
          const dir = join(tmp.dir, `${s.id.replace(/[^a-z0-9]+/gi, '-')}-shards`);
          mkdirSync(dir, { recursive: true });
          const plan = await limit(async () =>
            planShards(s, { ...env, ...(await envFor(s, 1))[0] }, history(s), k, undefined, onlyOf(s)),
          );
          const code = await runShards({
            renewEnv: async () => (await envFor(s, 1))[0],
            name: s.name,
            config: s.config,
            k,
            shardFiles: plan,
            passthrough: plan === undefined ? [...passthrough, ...filesArgs(s)] : passthrough,
            env,
            tmpDir: dir,
            reportPath: join(ROOT, s.report),
            cwd: ROOT,
            limit,
          });
          console.log(
            `e2e: ${s.name} ${code === 0 ? 'passed' : 'FAILED'} in ${Math.round((Date.now() - t0) / 1000)} s since the run started`,
          );
          if (track(s, code) !== 0) failed.push(s.name);
          if (passthrough.length === 0) recordDurations(s);
        }),
    );
    result = { ok: failed.length === 0, failed, missing };
  }
  if (alone.length > 0) {
    for (const s of alone) console.log(`e2e: ${s.name} runs alone after the others: ${RUN_ALONE[s.id]}`);
    result = mergeResults(result, await plain(alone));
  }
  tmp.remove();
  if (affected) result = judgeAffected(ROOT, selected, result.missing, codes);
  else result = fileFilter.judge(result, ROOT, selected, passthrough);
  if (result.missing.length > 0) console.error(`e2e: missing suite config: ${result.missing.join(', ')}`);
  if (!result.ok) console.error(`e2e: failed suites: ${result.failed.join(', ')}`);
  recorder.finish(result.ok ? 0 : 1, { suites: selected.length, ...summarizeReports(ROOT, selected) });
  process.exit(result.ok ? 0 : 1);
}
