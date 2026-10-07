#!/usr/bin/env node
// Runs npm scripts one after the other, like `npm run a && npm run b`, and records how long each step
// took in metrics/raw/check-steps.jsonl (WP-930). Stops at the first red step and exits with its code.
// Usage: node scripts/ops/steps.mjs [--parallel [--fail-fast] [--before <npm script>] [--after <npm script>]] <suite> <npm script>...
//   (suite: a label, e.g. check, fast). With --parallel (WP-981) the steps start together, each one's output
//   is buffered and printed whole when it ends, and the exit code is the first failing step's in the given
//   order; --before runs one script first, alone (shared generation that parallel steps must not race on).
//   --after <script> (WP-1022) runs one script alone once the whole group is green (a timing bench must not
//   share the CPU with the group); a red group skips it.
//   --fail-fast (WP-1015, with --parallel): when a step is red the others are killed (their whole process group),
//   recorded with the kill code and `killed: true`; the red step's output is printed at once.
// A steps run started inside another one records `parent` (the outer suite), so nested suites can be
// told apart. UB_NO_RECORD=1 skips the record; UEB_STEPS_OUT=<dir> writes it there instead (tests).
import { spawn } from 'node:child_process';
import { availableParallelism, constants, loadavg } from 'node:os';
import { pathToFileURL } from 'node:url';
import { requireOwnPackages } from './own-packages.mjs';
import { append, gateWaitField, git, rawDir, where } from '../metrics/lib.mjs';

/** The running steps, so a SIGINT/SIGTERM sent to the runner (a land or gate kill) reaches them too (see main). */
const running = new Set();

/** Runs `cmd args` with inherited stdio; resolves to its exit code (128 + n when killed by signal n, as sh reports it). */
function exec(cmd, args, env) {
  return new Promise((res) => {
    // Own process group: npm runs the script under sh, which does not pass signals on, so a kill goes to the group.
    const child = spawn(cmd, args, { stdio: 'inherit', env, detached: true });
    running.add(child);
    child.on('error', () => res(127));
    child.on('close', (code, signal) => {
      running.delete(child);
      res(code ?? 128 + (constants.signals[signal] ?? 0));
    });
  });
}

/** Like exec, but stdout and stderr are collected (in arrival order) and returned with the exit code. */
function execBuffered(cmd, args, env, signal) {
  return new Promise((res) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env, detached: true });
    running.add(child);
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* the group is already gone */
      }
    };
    if (signal?.aborted) kill();
    else signal?.addEventListener('abort', kill, { once: true });
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => chunks.push(c));
    const done = (exit) => {
      running.delete(child);
      res({ exit, output: Buffer.concat(chunks).toString('utf8') });
    };
    child.on('error', () => done(127));
    child.on('close', (code, signal) => done(code ?? 128 + (constants.signals[signal] ?? 0)));
  });
}

/**
 * Runs the steps in order and stops at the first non-zero exit. `run(name)` resolves to an exit
 * code; `now()` gives milliseconds. Pure apart from those two, so the spec can drive it.
 */
export async function runSteps(names, run, now = Date.now) {
  const steps = [];
  for (const name of names) {
    const t0 = now();
    const exit = await run(name);
    steps.push({ name, ms: Math.round(now() - t0), exit });
    if (exit !== 0) break;
  }
  const failed = steps.find((s) => s.exit !== 0);
  return { steps, exitCode: failed ? failed.exit : 0, failedStep: failed ? failed.name : null };
}

/**
 * Starts every step at once. `run(name)` resolves to `{ exit, output }`; when a step ends, `print(name,
 * output, exit)` is called (synchronously, so two steps' output never interleaves). Waits for all and
 * returns the first failing step's code in the given order. Rows carry `parallel: true`. With
 * `opts.failFast`, the first step to end red aborts `run`'s signal (the others are stopped; their rows carry
 * `killed: true`), and the result is that step's. `run(name, signal)`.
 */
export async function runStepsParallel(names, run, now = Date.now, print = () => {}, opts = {}) {
  const abort = new AbortController();
  let firstRed = null;
  const results = await Promise.all(
    names.map(async (name) => {
      const t0 = now();
      const { exit, output } = await run(name, abort.signal);
      const ms = Math.round(now() - t0);
      // A step that ends non-zero after the first red one was only stopped by it: it is killed, not failed.
      const killed = opts.failFast && firstRed !== null && exit !== 0;
      if (opts.failFast && exit !== 0 && firstRed === null) {
        firstRed = name;
        abort.abort();
      }
      if (!killed) print(name, output, exit);
      return { name, ms, exit, parallel: true, ...(killed ? { killed: true } : {}) };
    }),
  );
  const failed = opts.failFast
    ? (results.find((s) => s.name === firstRed) ?? null)
    : results.find((s) => s.exit !== 0);
  return { steps: results, exitCode: failed ? failed.exit : 0, failedStep: failed ? failed.name : null };
}

/** Prints one buffered step whole, framed with its name, so the logs of parallel steps stay readable. */
function printFramed(name, output, exit) {
  const out = exit === 0 ? process.stdout : process.stderr;
  out.write(
    `── ${name} (${exit === 0 ? 'ok' : `exit ${exit}`}) ──\n${output}${output.endsWith('\n') || !output ? '' : '\n'}`,
  );
}

function gitTreeOfHead() {
  try {
    return git('rev-parse', 'HEAD^{tree}');
  } catch {
    return null;
  }
}

async function main(argv) {
  const parallel = argv[0] === '--parallel';
  if (parallel) argv = argv.slice(1);
  const failFast = parallel && argv[0] === '--fail-fast';
  if (failFast) argv = argv.slice(1);
  let before = null;
  let after = null;
  while (argv[0] === '--before' || argv[0] === '--after') {
    if (argv[0] === '--before') before = argv[1];
    else after = argv[1];
    argv = argv.slice(2);
  }
  const [suite, ...names] = argv;
  if (!suite || names.length === 0) {
    console.error(
      'usage: steps.mjs [--parallel [--fail-fast] [--before <npm script>] [--after <npm script>]] <suite> <npm script>...',
    );
    return 2;
  }
  for (const sig of ['SIGINT', 'SIGTERM'])
    process.on(sig, () => {
      try {
        for (const c of running) if (c.pid) process.kill(-c.pid, sig);
      } catch {
        /* the group is already gone */
      }
    });
  // WP-1041: the check and changed suites must test this checkout's packages, not main's; a repair or a refusal
  // happens before any step, and the rows say the guard passed (check-recorded ignores rows that say it did not).
  const own = suite === 'check' || suite === 'changed' ? requireOwnPackages() : null;
  const parent = process.env.UEB_STEPS_SUITE || null;
  if (own && !own.ok) {
    if (!process.env.UB_NO_RECORD)
      append(
        'check-steps.jsonl',
        {
          ...where(),
          gitTree: gitTreeOfHead(),
          suite,
          parent,
          exitCode: 1,
          failedStep: 'own-packages',
          ownPackages: false,
          steps: [],
        },
        process.env.UEB_STEPS_OUT ?? rawDir(),
      );
    return 1;
  }
  const env = { ...process.env, UEB_STEPS_SUITE: suite };
  const load1 = loadavg()[0];
  const t0 = Date.now();
  const npm = (name) => ['run', '--silent', name];
  let result;
  if (!parallel) result = await runSteps(names, (name) => exec('npm', npm(name), env));
  else {
    const head = before ? await runSteps([before], (name) => exec('npm', npm(name), env)) : null;
    if (head && head.exitCode !== 0) result = head;
    else {
      const group = await runStepsParallel(
        names,
        (name, signal) =>
          execBuffered('npm', npm(name), process.stdout.isTTY ? { ...env, FORCE_COLOR: '1' } : env, signal),
        Date.now,
        printFramed,
        { failFast },
      );
      result = { ...group, steps: [...(head?.steps ?? []), ...group.steps] };
      if (after && result.exitCode === 0) {
        const tail = await runSteps([after], (name) => exec('npm', npm(name), env));
        result = { ...tail, steps: [...result.steps, ...tail.steps] };
      }
    }
  }
  if (!process.env.UB_NO_RECORD) {
    append(
      'check-steps.jsonl',
      {
        ...where(),
        gitTree: gitTreeOfHead(),
        suite,
        parent,
        exitCode: result.exitCode,
        failedStep: result.failedStep,
        wallMs: Date.now() - t0,
        ...gateWaitField(),
        load1: Number(load1.toFixed(1)),
        nproc: availableParallelism(),
        ...(own ? { ownPackages: true } : {}),
        ...(parallel ? { parallel: true } : {}),
        ...(failFast ? { failFast: true } : {}),
        steps: result.steps,
      },
      process.env.UEB_STEPS_OUT ?? rawDir(),
    );
  }
  if (result.failedStep)
    console.error(`steps: ${suite} stopped at ${result.failedStep} (exit ${result.exitCode})`);
  return result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
