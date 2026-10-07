import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { judgeChanged } from './check-recorded.mjs';
import { specEnv } from '../testing/spec-env.mjs';

// WP-953: `check-recorded.mjs --kind changed` accepts a green check:changed run (check-steps.jsonl,
// suite changed) or a green full check of the exact tree.
const T = 'a'.repeat(40);
const C = 'b'.repeat(40);
const ref = { tree: T, sha: C };
const green = {
  at: '2026-10-01T10:00:00Z',
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
const step = {
  at: '2026-10-01T10:00:00Z',
  gitTree: T,
  sha: C.slice(0, 8),
  tree: 'clean',
  suite: 'changed',
  parent: null,
  exitCode: 0,
  wallMs: 5,
} as const;

describe('judgeChanged', () => {
  it('WP-1041: a row that failed the own-packages guard never counts; an old row without the field does', () => {
    expect(judgeChanged([], [{ ...step, ownPackages: false }], ref).ok).toBe(false);
    expect(judgeChanged([], [{ ...step, ownPackages: true }], ref).ok).toBe(true);
    expect(judgeChanged([], [step], ref).ok).toBe(true);
  });
  it('accepts a green check:changed run of the tree', () => {
    expect(judgeChanged([], [step], ref)).toEqual({ ok: true, record: step, via: 'changed' });
  });
  it('accepts a full check record as well', () => {
    expect(judgeChanged([green], [{ ...step, suite: 'check' }], ref)).toMatchObject({
      ok: true,
      via: 'check',
    });
  });
  it.each([
    ['another tree', { gitTree: 'c'.repeat(40) }, 'no record'],
    ['dirty', { tree: 'deadbeef' }, 'dirty'],
    ['red', { exitCode: 1 }, 'red'],
    ['nested in another suite', { parent: 'check' }, 'no record'],
    ['another suite', { suite: 'fast' }, 'no record'],
  ] as const)('rejects %s', (_n, patch, word) => {
    expect(judgeChanged([], [{ ...step, ...patch }], ref)).toMatchObject({
      ok: false,
      reason: expect.stringContaining(word),
    });
  });
  it('a red full check does not hide a green changed run, and the reverse', () => {
    expect(judgeChanged([{ ...green, exitCode: 1 }], [step], ref).ok).toBe(true);
    expect(
      judgeChanged(
        [green],
        [
          { ...step, suite: 'check' },
          { ...step, exitCode: 1 },
        ],
        ref,
      ).ok,
    ).toBe(true);
  });
});

describe('cli --kind changed', () => {
  it('finds a changed record in check-steps.jsonl and refuses without one', () => {
    const repo = mkdtempSync(join(tmpdir(), 'chk-chg-'));
    try {
      const g = (...a: string[]) =>
        execFileSync('git', a, { cwd: repo, encoding: 'utf8', env: specEnv() }).trim();
      g('init', '-q');
      writeFileSync(join(repo, 'f'), 'x');
      g('add', '.');
      g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'one');
      mkdirSync(join(repo, 'metrics/raw'), { recursive: true });
      const script = resolve('scripts/ops/check-recorded.mjs');
      const run = (...a: string[]) => {
        try {
          const out = execFileSync('node', [script, ...a], { cwd: repo, encoding: 'utf8', env: specEnv() });
          return { code: 0, out };
        } catch (e) {
          const x = e as { status: number; stdout: string };
          return { code: x.status, out: x.stdout };
        }
      };
      expect(run('HEAD', '--kind', 'changed').code).toBe(1);
      const row = { at: 'x', tree: 'clean', suite: 'changed', parent: null, exitCode: 0, wallMs: 9 };
      writeFileSync(
        join(repo, 'metrics/raw/check-steps.jsonl'),
        JSON.stringify({ ...row, gitTree: g('rev-parse', 'HEAD^{tree}') }) + '\n',
      );
      const ok = run('HEAD', '--kind', 'changed');
      expect(ok.code).toBe(0);
      expect(ok.out).toContain('check:changed');
      expect(run('HEAD').code).toBe(1); // the default kind is still the full check
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 30_000);
});
