import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
import {
  buildRow,
  callerOf,
  modeOf,
  startRecording,
  summarizeReports,
  // @ts-expect-error plain .mjs without declarations
} from './run-record.mjs';

type Row = Record<string, unknown>;
const build = buildRow as (o: Row) => Row;
const base = { branch: 'wp/WP-1', sha: 'abc1234', suites: 4, shards: 4, specs: 30, wallMs: 90_000 };

describe('modeOf and callerOf', () => {
  const mode = modeOf as (a: Row, env?: Record<string, string>) => string;
  const caller = callerOf as (env: Record<string, string>) => string;
  it('tells full, affected, filter and main-watch apart', () => {
    expect(mode({})).toBe('full');
    expect(mode({ affected: 'main' })).toBe('affected');
    expect(mode({ names: ['a11y'] })).toBe('filter');
    expect(mode({ names: [], rest: ['--grep', 'x'] })).toBe('filter');
    expect(mode({}, { UEB_E2E_CALLER: 'main-watch' })).toBe('main-watch');
  });
  it('is train under the land slot, agent otherwise', () => {
    expect(caller({ UEB_GATE_HELD: 'land.slot:123' })).toBe('train');
    expect(caller({ UEB_GATE_HELD: 'e2e.slot:123' })).toBe('agent');
    expect(caller({})).toBe('agent');
  });
});

describe('buildRow', () => {
  it('a green run of each mode', () => {
    for (const mode of ['full', 'affected', 'filter', 'main-watch']) {
      const r = build({ ...base, mode, caller: 'agent', exitCode: 0, gateWaitMs: 1500 });
      expect(r).toMatchObject({ mode, exitCode: 0, failed: 0, quarantinedRed: 0, infra: false });
      expect(r).toMatchObject({ suites: 4, shards: 4, specs: 30, wallMs: 90_000, gateWaitMs: 1500 });
    }
  });
  it('a failed run with a failing spec is not infra; only quarantined reds with a non-zero exit is', () => {
    expect(build({ ...base, mode: 'full', caller: 'agent', exitCode: 1, failed: 2 }).infra).toBe(false);
    const q = build({ ...base, mode: 'full', caller: 'agent', exitCode: 1, failed: 2, quarantinedRed: 2 });
    expect(q.infra).toBe(true);
  });
  it('an infrastructure failure: non-zero exit and no failing spec', () => {
    const r = build({ ...base, mode: 'affected', caller: 'train', exitCode: 1 });
    expect(r).toMatchObject({ infra: true, caller: 'train' });
  });
  it('omits gateWaitMs when the run was not gated', () => {
    expect('gateWaitMs' in build({ ...base, mode: 'full', caller: 'agent', exitCode: 0 })).toBe(false);
  });
});

describe('startRecording', () => {
  const fakeProc = () => {
    const handlers = new Map<string, (c?: number) => void>();
    return {
      handlers,
      on: (e: string, h: (c?: number) => void) => handlers.set(e, h),
      off: (e: string) => handlers.delete(e),
      exit: () => undefined,
    };
  };
  it('writes exactly one row, also when finish and the exit hook both fire', () => {
    const rows: Row[] = [];
    const proc = fakeProc();
    const rec = startRecording(
      { mode: 'full', suites: 1 },
      { write: (r: Row) => rows.push(r), env: {}, proc },
    );
    const exit = proc.handlers.get('exit');
    rec.finish(0, { specs: 5 });
    exit?.(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ exitCode: 0, specs: 5, mode: 'full', caller: 'agent' });
  });
  it('a crash still writes a row with the exit code (exit hook)', () => {
    const rows: Row[] = [];
    const proc = fakeProc();
    startRecording({ mode: 'affected' }, { write: (r: Row) => rows.push(r), env: {}, proc });
    proc.handlers.get('exit')?.(1);
    expect(rows).toEqual([expect.objectContaining({ exitCode: 1, infra: true })]);
  });
  it('Ctrl-C writes exit 130', () => {
    const rows: Row[] = [];
    const proc = fakeProc();
    startRecording({ mode: 'full' }, { write: (r: Row) => rows.push(r), env: {}, proc });
    proc.handlers.get('SIGINT')?.();
    expect(rows[0]?.exitCode).toBe(130);
  });
  it('cancel writes nothing', () => {
    const rows: Row[] = [];
    const proc = fakeProc();
    const rec = startRecording({ mode: 'full' }, { write: (r: Row) => rows.push(r), env: {}, proc });
    rec.cancel();
    expect(proc.handlers.size).toBe(0);
    expect(rows).toHaveLength(0);
  });
});

describe('summarizeReports', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'run-record-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  it('counts specs and failed; a missing report counts nothing', () => {
    const report = {
      stats: { expected: 3, unexpected: 2, flaky: 0, skipped: 1 },
      suites: [],
    };
    mkdirSync(join(dir, 'r'), { recursive: true });
    writeFileSync(join(dir, 'r/one.json'), JSON.stringify(report));
    const out = (summarizeReports as (...a: unknown[]) => Row)(
      dir,
      [
        { id: 'one', name: 'one', report: 'r/one.json' },
        { id: 'two', name: 'two', report: 'r/none.json' },
      ],
      [],
    );
    expect(out).toEqual({ specs: 6, failed: 2, quarantinedRed: 0 });
  });
});

describe('one row per run, in the main checkout, also from a worktree', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'run-record-wt-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  it('a crashing process appends one row to <main>/metrics/raw/e2e-runs.jsonl', () => {
    const main = join(dir, 'main');
    const wt = join(dir, 'wt');
    const sh = (cwd: string, ...a: string[]) =>
      execFileSync('git', a, { cwd, stdio: 'pipe', env: specEnv() });
    mkdirSync(main);
    sh(main, 'init', '-q', '-b', 'main');
    sh(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'i');
    sh(main, 'worktree', 'add', '-q', '-b', 'wp/WP-9', wt);
    const mod = fileURLToPath(new URL('./run-record.mjs', import.meta.url));
    const script = `import { startRecording } from ${JSON.stringify(mod)};
      startRecording({ mode: 'filter', suites: 1, shards: 2 }); process.exit(3);`;
    const env = { ...specEnv(), UEB_GATE_HELD: '', UEB_GATE_WAIT_MS: '' };
    try {
      execFileSync('node', ['--input-type=module', '-e', script], { cwd: wt, env, stdio: 'pipe' });
    } catch {
      // exit 3 is the point
    }
    const file = join(main, 'metrics/raw/e2e-runs.jsonl');
    expect(existsSync(file)).toBe(true);
    expect(existsSync(join(wt, 'metrics/raw/e2e-runs.jsonl'))).toBe(false);
    const rows = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Row);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      branch: 'wp/WP-9',
      mode: 'filter',
      exitCode: 3,
      infra: true,
      caller: 'agent',
    });
    expect(typeof rows[0]?.at).toBe('string');
  });
});
