// `npm run e2e:main` (WP-978): runs the whole e2e suite on main's tip in a dedicated worktree and records one row in
// metrics/raw/e2e.jsonl. A red that the previous row did not have lands in metrics/raw/ATTENTION.md. A watcher, not a
// gate: it exits 0 on red. Schedule: scripts/e2e/e2e-main.timer (docs/process/e2e.md).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { append, attention, readJsonl } from '../metrics/lib.mjs';
import { ensureNodeModules } from '../ops/link-node-modules.mjs';
import { extractDetail, stripAnsi, writeDetails } from './main-watch-details.mjs';

/** The kind that tells this watcher's rows from e2e triage's in e2e.jsonl. */
export const KIND = 'main-watch';
export const MAX_ALARM_SPECS = 10;

/** The first non-blank line of an error message, colour codes removed. */
export function firstLine(text) {
  return (
    stripAnsi(text)
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  );
}

function* walkSpecs(suites) {
  for (const s of suites ?? []) {
    for (const spec of s.specs ?? []) yield spec;
    yield* walkSpecs(s.suites);
  }
}

const BAD = new Set(['failed', 'timedOut', 'interrupted']);

/**
 * One suite's result from its Playwright JSON report (null when the suite wrote none: a build or config failure).
 * A failing spec's id is `<suite>:<file>:<line>:<title>`.
 */
export function summarizeSuite(suite, report) {
  if (!report)
    return {
      id: suite.id,
      name: suite.name,
      passed: 0,
      failed: 1,
      failing: [
        { id: `${suite.id}:(no report)`, error: 'the suite wrote no report (build or config failed)' },
      ],
      details: [],
    };
  const failing = [];
  const details = [];
  for (const spec of walkSpecs(report.suites)) {
    for (const t of spec.tests ?? []) {
      const r = t.results?.at(-1);
      if (!r || !BAD.has(r.status)) continue;
      const message = r.error?.message ?? (r.errors ?? []).map((e) => e.message).join('\n');
      const id = `${suite.id}:${spec.file}:${spec.line}:${spec.title}`;
      failing.push({ id, error: firstLine(message) });
      details.push({ id, detail: extractDetail(r, t.retries ?? t.results.length - 1) });
    }
  }
  const stats = report.stats ?? {};
  return {
    id: suite.id,
    name: suite.name,
    passed: stats.expected ?? 0,
    failed: Math.max(stats.unexpected ?? 0, failing.length),
    failing,
    details,
  };
}

/** The reds in `row` that `prev` (the row for the older sha) did not have. No previous row: all of them. */
export function newReds(prev, row) {
  const known = new Set((prev?.failing ?? []).map((x) => x.id));
  return row.failing.filter((x) => !known.has(x.id));
}

/** The ATTENTION entry for new reds: a title with the sha, one line per spec (max 10), a pointer to the rest. */
export function attentionBlock(row, fresh) {
  const lines = fresh.slice(0, MAX_ALARM_SPECS).map((x) => `${x.id}: ${x.error}`);
  if (fresh.length > MAX_ALARM_SPECS)
    lines.push(`and ${fresh.length - MAX_ALARM_SPECS} more (metrics/raw/e2e.jsonl)`);
  if (row.details) lines.push(`full errors: ${row.details}`);
  return { title: `e2e red on main ${row.sha.slice(0, 7)}`, lines };
}

/** Run or skip: main unmoved since the last row, or the 1-minute load above the core count. */
export function decide({ head, last, load, cores }) {
  if (last?.sha === head) return { run: false, reason: `main unmoved at ${head.slice(0, 7)}` };
  if (load > cores) return { run: false, reason: `load ${load} above ${cores} cores` };
  return { run: true };
}

/**
 * One watch pass with every effect injected. `rows` are the earlier main-watch rows (oldest first), `runE2e()`
 * resolves to `{ suites, exit }`. Skips are logged and write nothing.
 */
export async function watch({
  head,
  rows,
  load,
  cores,
  runE2e,
  now,
  append: write,
  attention: alarm,
  log,
  writeDetails: details,
}) {
  const last = rows.at(-1);
  const d = decide({ head, last, load, cores });
  if (!d.run) {
    log(`e2e:main skipped: ${d.reason}`);
    return { action: 'skip', reason: d.reason };
  }
  const t0 = now();
  const { suites, exit } = await runE2e();
  const entries = suites.flatMap((s) => s.details ?? []);
  const row = {
    kind: KIND,
    sha: head,
    suites: suites.map((s) => ({ ...s, details: undefined })),
    passed: suites.reduce((n, s) => n + s.passed, 0),
    failed: suites.reduce((n, s) => n + s.failed, 0),
    failing: suites.flatMap((s) => s.failing),
    exit,
    ms: now() - t0,
  };
  if (entries.length > 0 && details) row.details = details({ sha: head, nowMs: t0, entries });
  write(row);
  const fresh = newReds(last, row);
  log(`e2e:main ${head.slice(0, 7)}: ${row.passed} passed, ${row.failed} failed, ${fresh.length} new red`);
  if (fresh.length > 0) {
    const b = attentionBlock(row, fresh);
    alarm(b.title, b.lines);
  }
  return { action: 'ran', row };
}

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

/** `<main checkout>-e2e`, a sibling of the main checkout and outside .claude/worktrees. */
export const worktreePath = (main) => resolve(main, '..', `${main.split('/').pop()}-e2e`);

/** Creates the detached worktree once, then resets it to main's tip. Returns the sha. */
export function prepareWorktree(main, wt) {
  const head = git(main, 'rev-parse', 'main');
  if (!existsSync(wt))
    execFileSync('git', ['-C', main, 'worktree', 'add', '--detach', wt, head], { stdio: 'inherit' });
  else {
    git(wt, 'checkout', '--detach', '--force', head);
    git(wt, 'clean', '-fdq'); // ignored files (apps/web/build, node_modules) stay
  }
  // Playwright artifacts never accumulate: wiped before each run, the one build is reused.
  for (const d of ['apps/web/test-results', 'apps/web/playwright-report'])
    rmSync(join(wt, d), { recursive: true, force: true });
  return head;
}

/** Runs `npm run e2e` in `wt` at nice 10 (a long job: the light pool is for short bursts) and reads every suite's report. */
export async function runInWorktree(wt) {
  const link = ensureNodeModules({
    worktree: wt,
    replace: true,
    npmCi: (_cwd, reason) => {
      console.error(`e2e:main: cannot link node_modules (${reason}); never npm ci here`);
      return 1;
    },
  });
  if (link.status !== 0) throw new Error(`node_modules: ${link.reason}`);
  const run = spawnSync('nice', ['-n', '10', 'npm', 'run', 'e2e'], { cwd: wt, stdio: 'inherit' });
  const { allSuites } = await import(pathToFileURL(join(wt, 'scripts/e2e/run.mjs')).href);
  const suites = allSuites(wt).map((s) => {
    const f = join(wt, s.report);
    let report = null;
    try {
      report = JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      /* no report: summarizeSuite records the suite as failed */
    }
    return summarizeSuite(s, report);
  });
  return { suites, exit: run.status ?? 1 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const main = dirname(
    execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
    }).trim(),
  );
  const rows = readJsonl('e2e.jsonl').filter((r) => r.kind === KIND);
  const wt = worktreePath(main);
  const head = git(main, 'rev-parse', 'main');
  const cores = availableParallelism();
  const load = Number(loadavg()[0].toFixed(2));
  // The worktree is reset inside runE2e, so a skip touches nothing.
  await watch({
    head,
    rows,
    load,
    cores,
    runE2e: async () => {
      prepareWorktree(main, wt);
      return runInWorktree(wt);
    },
    now: () => Date.now(),
    append: (row) => append('e2e.jsonl', row),
    attention: (title, lines) => attention(title, lines),
    writeDetails: (p) => writeDetails({ ...p, dir: join(main, 'metrics/raw/e2e') }),
    log: (m) => console.log(m),
  }).catch((e) => {
    console.error(`e2e:main failed: ${e.message}`);
    attention('e2e:main could not run', [firstLine(e.message)]);
  });
}
