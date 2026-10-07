// WP-1023: every `npm run e2e` run appends one row to metrics/raw/e2e-runs.jsonl in the main checkout (the same place
// tests.jsonl rows go, via metrics/lib.mjs), so we can see where agents wait on e2e: mode, wall, shards, gate wait, result.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { append, git, gateWaitField } from '../metrics/lib.mjs';
import { loadQuarantine, testsOf } from './affected-quarantine.mjs';

export const RUNS_FILE = 'e2e-runs.jsonl';

/** full (no selection), affected (`--affected`), filter (`--suite` or Playwright arguments) or main-watch (`e2e:main`). */
export function modeOf({ affected, names = [], rest = [] }, env = process.env) {
  if (env.UEB_E2E_CALLER === 'main-watch') return 'main-watch';
  if (affected !== undefined) return 'affected';
  return names.length > 0 || rest.length > 0 ? 'filter' : 'full';
}

/** train when the land train holds its slot (check-gate.sh exports UEB_GATE_HELD=land.slot:<pid>), main-watch for e2e:main, else agent. */
export function callerOf(env = process.env) {
  if (env.UEB_E2E_CALLER === 'main-watch') return 'main-watch';
  return String(env.UEB_GATE_HELD ?? '').startsWith('land.slot') ? 'train' : 'agent';
}

/** The pure row: counts default to 0, infra is a non-zero exit with no failing spec beyond the quarantined ones. */
export function buildRow(o) {
  const failed = o.failed ?? 0;
  const quarantinedRed = o.quarantinedRed ?? 0;
  const exitCode = o.exitCode ?? 1;
  return {
    branch: o.branch,
    sha: o.sha,
    mode: o.mode,
    suites: o.suites ?? 0,
    shards: o.shards ?? 0,
    specs: o.specs ?? 0,
    wallMs: Math.max(0, Math.round(o.wallMs ?? 0)),
    ...(o.gateWaitMs === undefined ? {} : { gateWaitMs: o.gateWaitMs }),
    exitCode,
    failed,
    quarantinedRed,
    infra: exitCode !== 0 && failed - quarantinedRed <= 0,
    caller: o.caller,
  };
}

function safeQuarantine(root) {
  try {
    return loadQuarantine(root);
  } catch {
    return [];
  }
}

/** Counts from the suites' Playwright JSON reports (a missing report counts nothing): specs, failed (unexpected) and the quarantined reds. */
export function summarizeReports(root, suites, quarantine = safeQuarantine(root)) {
  const key = (t) => `${t.file}:${t.line}`;
  const q = new Set(quarantine.map(key));
  let specs = 0;
  let failed = 0;
  let quarantinedRed = 0;
  for (const suite of suites) {
    let report;
    try {
      report = JSON.parse(readFileSync(join(root, suite.report), 'utf8'));
    } catch {
      continue;
    }
    const s = report.stats ?? {};
    specs += (s.expected ?? 0) + (s.unexpected ?? 0) + (s.flaky ?? 0) + (s.skipped ?? 0);
    failed += s.unexpected ?? 0;
    quarantinedRed += testsOf(report, suite).filter((t) => t.status === 'unexpected' && q.has(key(t))).length;
  }
  return { specs, failed, quarantinedRed };
}

function headInfo() {
  try {
    return { branch: git('rev-parse', '--abbrev-ref', 'HEAD'), sha: git('rev-parse', '--short', 'HEAD') };
  } catch {
    return { branch: '?', sha: '?' };
  }
}

/**
 * Starts recording one run. Exactly one row is written: by `finish(exitCode, info)` or, when the process ends first
 * (process.exit, an exception, Ctrl-C), by the exit hook with the exit code. `cancel()` drops it (the process that only
 * hands over to the gated child). `info` is whatever is known by then: `{ suites, shards, specs, failed, quarantinedRed }`.
 */
export function startRecording(
  base,
  { write = (row) => append(RUNS_FILE, row), env = process.env, proc = process } = {},
) {
  const t0 = Date.now();
  const head = headInfo();
  let known = {};
  let done = false;
  const emit = (exitCode) => {
    if (done) return;
    done = true;
    try {
      write(
        buildRow({
          ...head,
          caller: callerOf(env),
          ...gateWaitField(env),
          ...base,
          ...known,
          wallMs: Date.now() - t0,
          exitCode,
        }),
      );
    } catch {
      // recording never changes the run's result
    }
  };
  const onExit = (code) => emit(code);
  const signalExit = (code) => () => {
    emit(code);
    proc.exit(code);
  };
  const sigint = signalExit(130);
  const sigterm = signalExit(143);
  proc.on('exit', onExit);
  proc.on('SIGINT', sigint);
  proc.on('SIGTERM', sigterm);
  const detach = () => {
    proc.off('exit', onExit);
    proc.off('SIGINT', sigint);
    proc.off('SIGTERM', sigterm);
  };
  return {
    update: (info) => {
      known = { ...known, ...info };
    },
    finish: (exitCode, info = {}) => {
      known = { ...known, ...info };
      emit(exitCode);
      detach();
    },
    cancel: () => {
      done = true;
      detach();
    },
  };
}
