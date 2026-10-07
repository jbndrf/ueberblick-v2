import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runSteps, runStepsParallel } from './steps.mjs';
import { specEnv } from '../testing/spec-env.mjs';

// WP-930: check steps run in order, stop at the first red one and are timed into check-steps.jsonl.
describe('runSteps', () => {
  it('runs every step in order and times each with the given clock', async () => {
    const seen: string[] = [];
    let t = 0;
    const r = await runSteps(
      ['a', 'b'],
      async (n: string) => {
        seen.push(n);
        t += 10;
        return 0;
      },
      () => t,
    );
    expect(seen).toEqual(['a', 'b']);
    expect(r).toEqual({
      steps: [
        { name: 'a', ms: 10, exit: 0 },
        { name: 'b', ms: 10, exit: 0 },
      ],
      exitCode: 0,
      failedStep: null,
    });
  });

  it('stops at the first red step and returns its exit code', async () => {
    const seen: string[] = [];
    const r = await runSteps(['a', 'b', 'c'], async (n: string) => {
      seen.push(n);
      return n === 'b' ? 3 : 0;
    });
    expect(seen).toEqual(['a', 'b']);
    expect(r.exitCode).toBe(3);
    expect(r.failedStep).toBe('b');
  });
});

// WP-981: the parallel mode starts every step, buffers output and returns the first red code in order.
describe('runStepsParallel', () => {
  it('runs every step, exits with the first failing code in the given order, rows carry parallel', async () => {
    const started: string[] = [];
    let t = 0;
    const r = await runStepsParallel(
      ['a', 'b', 'c', 'd'],
      async (n: string) => {
        started.push(n);
        t += 5;
        return { exit: n === 'c' ? 7 : n === 'd' ? 9 : 0, output: n };
      },
      () => t,
    );
    expect(started).toEqual(['a', 'b', 'c', 'd']);
    expect(r.exitCode).toBe(7);
    expect(r.failedStep).toBe('c');
    expect(r.steps.map((s) => [s.name, s.exit, s.parallel])).toEqual([
      ['a', 0, true],
      ['b', 0, true],
      ['c', 7, true],
      ['d', 9, true],
    ]);
    expect(r.steps.every((s) => typeof s.ms === 'number')).toBe(true);
  });

  it('a step finished early is reported first and each output is printed whole, never interleaved', async () => {
    const releases: Record<string, () => void> = {};
    const printed: string[] = [];
    const p = runStepsParallel(
      ['slow', 'fast'],
      (n: string) =>
        new Promise((res) => {
          releases[n] = () => res({ exit: 0, output: `${n}-1\n${n}-2\n` });
        }),
      () => 0,
      (name, output) => printed.push(`${name}:${output}`),
    );
    await Promise.resolve();
    releases['fast']?.();
    await new Promise((r) => setTimeout(r, 0));
    releases['slow']?.();
    const r = await p;
    expect(printed).toEqual(['fast:fast-1\nfast-2\n', 'slow:slow-1\nslow-2\n']);
    expect(r.exitCode).toBe(0);
  });
});

/** True while a process with this pid exists (signal 0 only probes). */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// WP-1015: --fail-fast kills the siblings of the first red step.
describe('runStepsParallel with failFast', () => {
  // A run that never ends on its own: it resolves only when the runner aborts it.
  const hanging = (signal: AbortSignal) =>
    new Promise<{ exit: number; output: string }>((res) =>
      signal.addEventListener('abort', () => res({ exit: 143, output: 'killed' })),
    );

  it('a failing step aborts a still-running sibling; its row is killed with the kill code', async () => {
    const r = await runStepsParallel(
      ['slow', 'red'],
      async (n: string, signal: AbortSignal) => (n === 'red' ? { exit: 5, output: 'boom' } : hanging(signal)),
      Date.now,
      () => {},
      { failFast: true },
    );
    expect(r.exitCode).toBe(5);
    expect(r.failedStep).toBe('red');
    expect(r.steps.find((s: { name: string }) => s.name === 'slow')).toMatchObject({
      exit: 143,
      killed: true,
    });
    expect(r.steps.find((s: { name: string }) => s.name === 'red')?.killed).toBeUndefined();
  });

  it('prints the failing output at once, before the others end', async () => {
    const printed: string[] = [];
    await runStepsParallel(
      ['slow', 'red'],
      async (n: string, signal: AbortSignal) => (n === 'red' ? { exit: 5, output: 'boom' } : hanging(signal)),
      Date.now,
      (n: string) => printed.push(n),
      { failFast: true },
    );
    expect(printed[0]).toBe('red');
  });

  it('without the flag every step finishes and none is killed', async () => {
    const r = await runStepsParallel(
      ['a', 'red', 'b'],
      async (n: string) => {
        await new Promise((res) => setTimeout(res, n === 'b' ? 20 : 0));
        return { exit: n === 'red' ? 5 : 0, output: n };
      },
      Date.now,
    );
    expect(r.steps.map((s: { exit: number }) => s.exit)).toEqual([0, 5, 0]);
    expect(r.steps.some((s: { killed?: boolean }) => s.killed)).toBe(false);
  });
});

describe('steps.mjs CLI', () => {
  const script = resolve(__dirname, 'steps.mjs');
  let dir: string;
  let out: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'steps-'));
    out = join(dir, 'out');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'steps-fixture',
        private: true,
        scripts: {
          ok: 'node -e "process.exit(0)"',
          red: 'node -e "process.exit(4)"',
          inner: `node ${script} inner ok`,
          // Writes its pid, then waits; the runner is killed while this step runs.
          hang: `node -e "require('fs').writeFileSync('hang.pid', String(process.pid)); setTimeout(() => {}, 60000)"`,
        },
      }),
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (...args: string[]) =>
    spawnSync('node', [script, ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: specEnv({ UB_NO_RECORD: '', UEB_STEPS_OUT: out }),
    });
  const rows = (): Array<Record<string, unknown>> =>
    readFileSync(join(out, 'check-steps.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  it('exits with the red step code and records every step it ran', () => {
    const r = run('s1', 'ok', 'red', 'ok');
    expect(r.status).toBe(4);
    const row = rows().at(-1) ?? {};
    expect(row).toMatchObject({ suite: 's1', exitCode: 4, failedStep: 'red' });
    expect((row['steps'] as Array<{ name: string }>).map((s) => s.name)).toEqual(['ok', 'red']);
    expect(typeof row['load1']).toBe('number');
  }, 30_000);

  it('a nested run records its parent suite', () => {
    const r = run('outer', 'inner');
    expect(r.status).toBe(0);
    const all = rows();
    expect(all.at(-2)).toMatchObject({ suite: 'inner', parent: 'outer', exitCode: 0 });
    expect(all.at(-1)).toMatchObject({ suite: 'outer', parent: null, exitCode: 0 });
  }, 30_000);

  it('a SIGTERM to the runner stops the running step and exits 143, and the run is recorded', async () => {
    const pidFile = join(dir, 'hang.pid');
    // A repeat finds the pid file of the previous run: waiting on it would kill the runner before it is up.
    rmSync(pidFile, { force: true });
    const child = spawn('node', [script, 'killed', 'hang', 'ok'], {
      cwd: dir,
      env: specEnv({ UB_NO_RECORD: '', UEB_STEPS_OUT: out }),
    });
    await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), { timeout: 20_000, interval: 50 });
    const stepPid = Number(readFileSync(pidFile, 'utf8'));
    child.kill('SIGTERM');
    const code = await new Promise<number | null>((res) => child.on('close', (c) => res(c)));
    expect(code).toBe(143);
    await vi.waitFor(() => expect(alive(stepPid)).toBe(false), { timeout: 10_000, interval: 50 });
    expect(rows().at(-1)).toMatchObject({ suite: 'killed', exitCode: 143, failedStep: 'hang' });
  }, 30_000);

  it('--parallel runs all steps, prints each framed, records parallel rows; --before runs first and alone', () => {
    const r = run('--parallel', '--before', 'ok', 'par', 'ok', 'red', 'ok');
    expect(r.status).toBe(4);
    expect(r.stderr).toContain('── red (exit 4) ──');
    expect(r.stdout).toContain('── ok (ok) ──');
    const row = rows().at(-1) ?? {};
    expect(row).toMatchObject({ suite: 'par', exitCode: 4, failedStep: 'red', parallel: true });
    const steps = row['steps'] as Array<{ name: string; parallel?: boolean }>;
    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatchObject({ name: 'ok' });
    expect(steps[0]?.parallel).toBeUndefined();
    expect(steps.slice(1).every((s) => s.parallel === true)).toBe(true);
  }, 30_000);

  it('--fail-fast kills a running sibling when a step is red and records it killed', () => {
    const r = run('--parallel', '--fail-fast', 'ff', 'hang', 'red');
    expect(r.status).toBe(4);
    const row = rows().at(-1) ?? {};
    const steps = row['steps'] as Array<{ name: string; killed?: boolean }>;
    expect(steps.find((x) => x.name === 'hang')?.killed).toBe(true);
    expect(steps.find((x) => x.name === 'red')?.killed).toBeUndefined();
  }, 30_000);

  it('a failing --before stops before the group', () => {
    const r = run('--parallel', '--before', 'red', 'par2', 'ok');
    expect(r.status).toBe(4);
    expect((rows().at(-1)?.['steps'] as unknown[]).length).toBe(1);
  }, 30_000);

  it('--after runs alone once the group is green, and is skipped when a group step is red', () => {
    const ok = run('--parallel', '--before', 'ok', '--after', 'ok', 'aft', 'ok', 'ok');
    expect(ok.status).toBe(0);
    const names = (rows().at(-1)?.['steps'] as Array<{ name: string; parallel?: boolean }>) ?? [];
    expect(names).toHaveLength(4);
    expect(names.at(-1)?.parallel).toBeUndefined();
    const red = run('--parallel', '--after', 'ok', 'aft2', 'ok', 'red');
    expect(red.status).toBe(4);
    expect((rows().at(-1)?.['steps'] as unknown[]).length).toBe(2);
    const redAfter = run('--parallel', '--after', 'red', 'aft3', 'ok');
    expect(redAfter.status).toBe(4);
    expect(rows().at(-1)).toMatchObject({ failedStep: 'red' });
  }, 30_000);

  it('wires check, check:fast and its parts through the step runner', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const s = pkg.scripts;
    // WP-1022: the full check runs its group in parallel; the bench measures timings, so it runs alone, after.
    expect(s['check']).toMatch(
      /steps\.mjs --parallel --fail-fast --before typecheck:gen --after bench:harness check check:fast boundaries test:record$/,
    );
    expect(s['check:fast:run']).toMatch(
      /steps\.mjs --parallel --fail-fast --before typecheck:gen fast typecheck lint glossary lint:ui-strings lint:max-lines$/,
    );
    expect(s['typecheck']).toMatch(
      /steps\.mjs --parallel --before typecheck:gen typecheck typecheck:root typecheck:ui typecheck:builder typecheck:bench typecheck:web$/,
    );
    // The parallel steps must not regenerate: the generated dirs are written once, by typecheck:gen.
    for (const k of ['typecheck:ui', 'typecheck:builder', 'typecheck:web'])
      expect(s[k]).not.toMatch(/i18n|svelte-kit sync/);
    expect(s['check:changed']).toMatch(
      /steps\.mjs --parallel --fail-fast --before typecheck:gen changed check:fast:scoped boundaries test:changed$/,
    );
    expect(s['lint']).toMatch(/steps\.mjs lint lint:eslint lint:prettier$/);
  });
});
