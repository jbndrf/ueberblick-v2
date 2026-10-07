import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { judge, judgeCheck, kindOf } from './check-recorded.mjs';
import { specEnv } from '../testing/spec-env.mjs';

const T = 'a'.repeat(40);
const C = 'b'.repeat(40);
const ref = { tree: T, sha: C };
const green = {
  at: '2026-09-30T10:00:00Z',
  gitTree: T,
  sha: C.slice(0, 8),
  tree: 'clean',
  kind: 'check',
  crashed: false,
  exitCode: 0,
  wallMs: 5,
  passed: 9,
  skipped: 0,
} as const;

describe('judge', () => {
  it('accepts a green full check for the tree', () => {
    const v = judge([green], ref);
    expect(v).toEqual({ ok: true, record: green });
  });
  it('rejects another tree', () => {
    const v = judge([{ ...green, gitTree: 'c'.repeat(40) }], ref);
    expect(v).toMatchObject({ ok: false, reason: expect.stringContaining('no record') });
  });
  it.each([
    ['dirty', { tree: 'deadbeef' }, 'dirty'],
    ['red', { exitCode: 1 }, 'red'],
    ['crashed', { crashed: true }, 'crashed'],
    ['scoped-only', { kind: 'scoped' }, 'scoped'],
    ['bare test', { kind: 'test' }, 'no full check'],
    ['old line without kind', { kind: undefined }, 'untyped'],
  ] as const)('rejects %s', (_n, patch, word) => {
    const v = judge([{ ...green, ...patch }], ref);
    expect(v).toMatchObject({ ok: false, reason: expect.stringContaining(word) });
  });
  it('a later green record wins over an earlier red one, and the reverse does not hide red', () => {
    const red = { ...green, exitCode: 1 };
    expect(judge([red, green], ref).ok).toBe(true);
    expect(judge([red], ref).ok).toBe(false);
  });
  it('matches old lines without gitTree by commit sha', () => {
    const old = { ...green, gitTree: undefined };
    expect(judge([old], ref).ok).toBe(true);
    expect(judge([old], { tree: T, sha: 'f'.repeat(40) }).ok).toBe(false);
  });
});

describe('judgeCheck (WP-1022: parallel steps)', () => {
  const outer = {
    at: '2026-09-30T10:00:00Z',
    gitTree: T,
    tree: 'clean',
    suite: 'check',
    parent: null,
    exitCode: 0,
    wallMs: 5,
  } as const;
  it('a green tests row plus a red outer check line is not ok', () => {
    expect(judgeCheck([green], [{ ...outer, exitCode: 1 }], ref)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('red'),
    });
  });
  it('a green tests row with no outer line is not ok', () => {
    expect(judgeCheck([green], [], ref).ok).toBe(false);
    expect(judgeCheck([green], [{ ...outer, parent: 'land' }], ref).ok).toBe(false);
    expect(judgeCheck([green], [{ ...outer, suite: 'changed' }], ref).ok).toBe(false);
    expect(judgeCheck([green], [{ ...outer, gitTree: 'c'.repeat(40) }], ref).ok).toBe(false);
    expect(judgeCheck([green], [{ ...outer, tree: 'deadbeef' }], ref).ok).toBe(false);
  });
  it('both green is ok; a red tests row is not, whatever the outer line says', () => {
    expect(judgeCheck([green], [outer], ref)).toEqual({ ok: true, record: green });
    expect(judgeCheck([{ ...green, exitCode: 1 }], [outer], ref).ok).toBe(false);
  });
});

describe('kindOf', () => {
  it('tells a full check from a bare test and from scoped runs', () => {
    expect(kindOf([], { UEB_GATE_HELD: 'slot.1:42' })).toBe('check');
    expect(kindOf([], {})).toBe('test');
    expect(kindOf(['packages/core'], { UEB_GATE_HELD: 'slot.1:42' })).toBe('scoped');
    expect(kindOf(['--changed'], {})).toBe('scoped');
  });
});

describe('cli', () => {
  let repo: string;
  // A fresh repo per test and per repeat: the test commits, so a shared one would be changed by the first run.
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'chk-rec-'));
    const g = (...a: string[]) =>
      execFileSync('git', a, { cwd: repo, encoding: 'utf8', env: specEnv() }).trim();
    g('init', '-q');
    writeFileSync(join(repo, 'f'), 'x');
    g('add', '.');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'one');
    mkdirSync(join(repo, 'metrics/raw'), { recursive: true });
    const tree = g('rev-parse', 'HEAD^{tree}');
    const sha = g('rev-parse', 'HEAD');
    writeFileSync(
      join(repo, 'metrics/raw/tests.jsonl'),
      JSON.stringify({ ...green, gitTree: tree, sha: sha.slice(0, 8) }) + '\n',
    );
    writeFileSync(
      join(repo, 'metrics/raw/check-steps.jsonl'),
      JSON.stringify({
        at: 'x',
        gitTree: tree,
        tree: 'clean',
        suite: 'check',
        parent: null,
        exitCode: 0,
        wallMs: 9,
      }) + '\n',
    );
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));
  const run = (arg: string) => {
    try {
      const out = execFileSync('node', [resolve('scripts/ops/check-recorded.mjs'), arg], {
        cwd: repo,
        encoding: 'utf8',
        env: specEnv(),
      });
      return { code: 0, out };
    } catch (e) {
      const x = e as { status: number; stdout: string };
      return { code: x.status, out: x.stdout };
    }
  };
  it('exits 0 for a recorded commit and 1 after the tree changes', () => {
    expect(run('HEAD').code).toBe(0);
    writeFileSync(join(repo, 'f'), 'y');
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'two'], {
      cwd: repo,
      env: specEnv(),
    });
    const r = run('HEAD');
    expect(r.code).toBe(1);
    expect(r.out).toContain('no record');
  });
});
