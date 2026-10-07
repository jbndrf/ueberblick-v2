#!/usr/bin/env node
// The one way to start vitest (WP-132). Vitest creates <tmpdir>/<21 random chars>/{client,ssr} (~25 MB)
// per run and never removes it. This gives it a TMPDIR that is deleted afterwards, also on failure.
//   CLI:     node scripts/ops/vitest-scoped.mjs <vitest args>     (the root npm scripts use this)
//   library: scopedTmp() for scripts that spawn vitest themselves (test-record, bench harness).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireOwnPackages } from './own-packages.mjs';

/** A scratch directory plus `env` (TMPDIR pointing at it, plus the marker the vitest configs require, see vitest-scoped.guard.mjs). `remove()` is idempotent and also runs on exit. */
export function scopedTmp(prefix = 'vitest-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const remove = () => rmSync(dir, { recursive: true, force: true });
  process.on('exit', remove);
  // Node's default SIGINT/SIGTERM termination skips 'exit' handlers, so clean up and exit explicitly.
  for (const [sig, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    process.on(sig, () => {
      remove();
      process.exit(code);
    });
  }
  return { dir, env: { ...process.env, TMPDIR: dir, UEB_VITEST_SCOPED: '1' }, remove };
}

/** WP-905: under overload (1-min load above the core count) a vitest run gets fewer workers. Returns the cap, or null to keep the default. */
export function maxWorkersCap({ load, nproc }) {
  return load > nproc ? Math.max(1, Math.floor(nproc / 4)) : null;
}

/** The vitest args to use: adds --maxWorkers=<cap> for a `run` under overload unless the caller set it; `say` is called once when it does. */
export function withWorkerCap(args, { load, nproc }, say = () => {}) {
  if (args[0] !== 'run' || args.some((a) => a.startsWith('--maxWorkers') || a.startsWith('--max-workers')))
    return args;
  const cap = maxWorkersCap({ load, nproc });
  if (cap === null) return args;
  say(
    `vitest-scoped: load ${load.toFixed(0)} is above ${nproc} cores, capping vitest to ${cap} workers for this run`,
  );
  return [...args, `--maxWorkers=${cap}`];
}

/**
 * The line to print for `--repeats N` (or `--repeats=N`), or null without it. Vitest's summary counts each test once
 * under --repeats, so without this line a reviewer's flake hunt looks as if it ran once.
 */
export function repeatsNote(args) {
  const at = args.findIndex((a) => a === '--repeats' || a.startsWith('--repeats='));
  if (at < 0) return null;
  const n = Number(args[at].includes('=') ? args[at].split('=')[1] : args[at + 1]);
  if (!Number.isInteger(n) || n < 1) return null;
  return `vitest-scoped: --repeats ${n}: every test runs ${n + 1} times; the summary below counts each test once`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // WP-1041: never test main's packages by accident; repairs the links or refuses.
  if (!requireOwnPackages().ok) process.exit(1);
  const tmp = scopedTmp();
  const note = repeatsNote(process.argv.slice(2));
  if (note) console.error(note);
  const args = withWorkerCap(process.argv.slice(2), { load: loadavg()[0], nproc: cpus().length }, (m) =>
    console.error(m),
  );
  const child = spawn('npx', ['vitest', ...args], { stdio: 'inherit', env: tmp.env });
  for (const sig of ['SIGINT', 'SIGTERM']) process.prependListener(sig, () => child.kill(sig));
  child.on('close', (code, signal) => {
    tmp.remove();
    process.exit(code ?? (signal ? 1 : 0));
  });
}
