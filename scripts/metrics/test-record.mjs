#!/usr/bin/env node
// Runs vitest once with the JSON reporter and records a summary in metrics/raw/tests.jsonl:
// counts, duration, failing test names (for flake detection), slowest tests, and resource use
// (workers, peak RSS of the whole process tree, CPU utilisation). Takes a fair share of the
// machine (scripts/ops/resources.mjs). Exit code is vitest's; `npm run check` uses this.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { append, where, rawDir, git, gateWaitField } from './lib.mjs';
import { kindOf } from '../ops/check-recorded.mjs';
import { acquire, availableMb } from '../ops/resources.mjs';
import { scopedTmp } from '../ops/vitest-scoped.mjs';
import { vitestArgs, recordedSelection } from '../ops/changed-base.mjs';

/** Sum of RSS (MB) of `root` and all its descendants, from /proc (Linux; 0 elsewhere). */
function treeRssMb(root) {
  try {
    const kids = new Map();
    const rss = new Map();
    for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        const ppid = f[1];
        kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
        rss.set(pid, (Number(f[21]) * 4096) / 1024 / 1024);
      } catch {
        /* process exited meanwhile */
      }
    }
    let total = 0;
    const stack = [String(root)];
    while (stack.length) {
      const p = stack.pop();
      total += rss.get(p) ?? 0;
      stack.push(...(kids.get(p) ?? []));
    }
    return total;
  } catch {
    return 0;
  }
}

/** CPU seconds of reaped children of this process (cutime + cstime from /proc/self/stat). */
function childCpuSec() {
  try {
    const stat = readFileSync('/proc/self/stat', 'utf8');
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return (Number(f[13]) + Number(f[14])) / 100;
  } catch {
    return 0;
  }
}

function gitTreeOfHead() {
  try {
    return git('rev-parse', 'HEAD^{tree}');
  } catch {
    return null;
  }
}

const SILENT_RED_MAX = 2000;
const STDERR_TAIL_LINES = 40;
/** Bounded stderr kept while the run streams. */
const STDERR_KEEP = 16_000;

const clip = (t, n) => String(t ?? '').slice(0, n);

/** Keeps a silentRed object under ~2 kB by shortening its longest text field. */
function capSilentRed(o) {
  const key = 'tail' in o ? 'tail' : 'message';
  const over = JSON.stringify(o).length - SILENT_RED_MAX;
  if (over > 0)
    o[key] = key === 'tail' ? o[key].slice(over) : o[key].slice(0, Math.max(0, o[key].length - over));
  return o;
}

/**
 * WP-1013: why a run exited non-zero with zero failed tests. `report` is vitest's JSON report (or null),
 * `stderr` the captured stderr. Returns undefined for a green run or a normal red (failed tests).
 */
export function silentRed({ code, report, stderr = '' }) {
  if (code === 0 || (report?.numFailedTests ?? 0) > 0) return undefined;
  const bad = (report?.testResults ?? []).find(
    (f) => f.status === 'failed' || (f.message && !(f.assertionResults ?? []).length),
  );
  if (bad)
    return capSilentRed({
      kind: 'suite',
      file: String(bad.name ?? '').replace(process.cwd() + '/', ''),
      message: String(bad.message ?? '')
        .split('\n')
        .slice(0, 8)
        .join('\n'),
    });
  const errs = report?.unhandledErrors;
  if (Array.isArray(errs) && errs.length)
    return capSilentRed({ kind: 'unhandled', message: clip(errs[0]?.message ?? errs[0], 1500) });
  const lines = stderr.split('\n');
  const at = lines.findIndex((l) => /Unhandled (Rejection|Error)|Vitest caught \d+ unhandled/i.test(l));
  if (at >= 0) return capSilentRed({ kind: 'unhandled', message: lines.slice(at, at + 8).join('\n') });
  return capSilentRed({ kind: 'unknown', tail: lines.slice(-STDERR_TAIL_LINES).join('\n') });
}

async function main() {
  const plan = await vitestArgs(process.argv.slice(2), process.cwd());
  for (const l of plan.lines) console.log(`check:changed ${l}`);
  const kind = kindOf(process.argv.slice(2), process.env);
  const slot = acquire(rawDir(), undefined, kind);
  const scratch = scopedTmp();
  const dir = scratch.dir;
  const out = join(dir, 'report.json');
  const availStart = availableMb();
  const cpu0 = childCpuSec();
  const t0 = Date.now();
  const child = spawn(
    'npx',
    [
      'vitest',
      ...plan.argv,
      `--maxWorkers=${slot.workers}`,
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${out}`,
    ],
    { stdio: ['inherit', 'inherit', 'pipe'], env: scratch.env },
  );
  let stderr = '';
  child.stderr.on('data', (d) => {
    process.stderr.write(d);
    stderr = (stderr + d).slice(-STDERR_KEEP);
  });
  let peakMb = 0;
  const poll = setInterval(() => (peakMb = Math.max(peakMb, treeRssMb(child.pid))), 250);
  const code = await new Promise((res) => child.on('close', (c) => res(c ?? 1)));
  clearInterval(poll);
  const wallMs = Date.now() - t0;
  const cpuSec = childCpuSec() - cpu0;
  slot.release();

  let report = null;
  try {
    report = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    /* vitest crashed before writing a report; recorded below as a crash */
  }
  const tests = (report?.testResults ?? []).flatMap((f) =>
    (f.assertionResults ?? []).map((a) => ({
      name: `${f.name.replace(process.cwd() + '/', '')} › ${a.fullName ?? a.title}`,
      status: a.status,
      ms: a.duration ?? 0,
    })),
  );
  if (!process.env.UB_NO_RECORD)
    append(
      'tests.jsonl',
      {
        ...where(),
        // git tree of the committed HEAD (what check-recorded matches); `kind` says full check or not.
        gitTree: gitTreeOfHead(),
        kind,
        // WP-1006: why a scoped run ran what it ran; full checks have no selection
        selection: kind === 'scoped' ? recordedSelection(plan) : undefined,
        crashed: !report,
        exitCode: code,
        files: report?.testResults?.length ?? 0,
        total: report?.numTotalTests ?? 0,
        passed: report?.numPassedTests ?? 0,
        failed: report?.numFailedTests ?? 0,
        skipped: (report?.numPendingTests ?? 0) + (report?.numTodoTests ?? 0),
        wallMs,
        ...gateWaitField(),
        workers: slot.workers,
        weight: slot.weight,
        budgetMb: slot.budgetMb,
        youngWeight: slot.youngWeight,
        byCpu: slot.byCpu,
        byMem: slot.byMem,
        memShareMb: slot.memShareMb,
        concurrentRuns: slot.runs,
        peakRssMb: Math.round(peakMb),
        availMbAtStart: Math.round(availStart),
        cpuUtil: Number((cpuSec / ((wallMs / 1000) * availableParallelism())).toFixed(3)),
        silentRed: silentRed({ code, report, stderr }),
        failing: tests.filter((t) => t.status === 'failed').map((t) => t.name),
        slowest: [...tests]
          .sort((a, b) => b.ms - a.ms)
          .slice(0, 5)
          .map((t) => ({ name: t.name, ms: Math.round(t.ms) })),
      },
      process.env.UEB_RECORD_OUT ?? rawDir(),
    );
  scratch.remove();
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
