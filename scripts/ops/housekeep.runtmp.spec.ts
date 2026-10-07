import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
import { HOUR, run, setupEnv, teardownEnv } from './housekeep.fixture';
import { remove, type Candidate } from './housekeep.mjs';
import { runTmpCandidates } from './housekeep.runtmp.mjs';

// WP-993: per-run temp dirs (vitest-XXXXXX, ueberblick-e2e-*) that killed runs leave behind.
let repo: string;
let tmp: string;
beforeEach(() => {
  ({ repo, tmp } = setupEnv());
});
afterEach(teardownEnv);

function runDir(name: string, ageMs: number): string {
  const dir = join(tmp, name);
  mkdirSync(join(dir, 'sub'), { recursive: true });
  writeFileSync(join(dir, 'sub', 'f.txt'), 'x');
  const t = new Date(Date.now() - ageMs);
  for (const p of [join(dir, 'sub', 'f.txt'), join(dir, 'sub'), dir]) utimesSync(p, t, t);
  return dir;
}
const found = (extra: Record<string, unknown> = {}) => run(extra).candidates.filter((c) => c.kind === 'tmp');

describe('housekeep per-run temp dirs', () => {
  it('a 7 h old dir is a candidate, a 1 h old one is kept; both name patterns match', () => {
    const v = runDir('vitest-aB3xY9', 7 * HOUR);
    const e = runDir('ueberblick-e2e-1234', 7 * HOUR);
    runDir('vitest-fresh1', 1 * HOUR);
    runDir('ueberblick-e2e-new', 1 * HOUR);
    runDir('vitest-toolong1', 7 * HOUR);
    runDir('unrelated', 7 * HOUR);
    expect(
      found()
        .map((c) => c.path)
        .sort(),
    ).toEqual([e, v].sort());
  });

  it('the newest file inside decides, not the directory', () => {
    const v = runDir('vitest-aB3xY9', 7 * HOUR);
    writeFileSync(join(v, 'sub', 'new.txt'), 'y');
    expect(found()).toEqual([]);
  });

  it('removes a candidate', () => {
    const v = runDir('vitest-aB3xY9', 7 * HOUR);
    expect(remove(found()[0] as Candidate, { repo })).toBe('');
    expect(existsSync(v)).toBe(false);
  });

  it('keeps a dir that a live child process has as its cwd', async () => {
    const v = runDir('vitest-aB3xY9', 7 * HOUR);
    const child = spawn('sleep', ['30'], { cwd: v, stdio: 'ignore', env: specEnv({}) });
    try {
      await new Promise((r) => child.once('spawn', r));
      expect(found({ procCwds: undefined })).toEqual([]);
    } finally {
      child.kill();
    }
    await new Promise((r) => child.once('exit', r));
    expect(found({ procCwds: undefined }).map((c) => c.path)).toEqual([v]);
  });

  it('keeps a dir that a child holds only through an open fd, its cwd being elsewhere (WP-996)', async () => {
    const v = runDir('vitest-aB3xY9', 7 * HOUR);
    const child = spawn('sh', ['-c', `exec 3<'${join(v, 'sub', 'f.txt')}'; echo ready; exec sleep 30`], {
      cwd: tmp,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: specEnv({}),
    });
    try {
      await new Promise((r) => child.stdout.once('data', r));
      expect(found({ procCwds: undefined })).toEqual([]);
    } finally {
      child.kill();
    }
    await new Promise((r) => child.once('exit', r));
    expect(found({ procCwds: undefined }).map((c) => c.path)).toEqual([v]);
  });

  it('a dir that vanishes between the scan and the realpath is skipped, not thrown (WP-996)', () => {
    const gone = runDir('vitest-gone01', 7 * HOUR);
    const kept = runDir('vitest-kept01', 7 * HOUR);
    const o = { tmp, repo, now: Date.now(), procCwds: () => [] };
    const out = runTmpCandidates(
      o,
      () => false,
      () => {
        rmSync(gone, { recursive: true, force: true });
        return [];
      },
    );
    expect(out.map((c: { path: string }) => c.path)).toEqual([kept]);
  });
});

// WP-1024: Playwright's transform cache, pruned file by file. The spec's tmp dir stands in for os.tmpdir().
describe('housekeep Playwright transform cache', () => {
  const cacheDir = () => join(tmp, `playwright-transform-cache-${process.geteuid?.() ?? 0}`);
  const entry = (rel: string, ageMs: number) => {
    const f = join(cacheDir(), rel);
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(f, 'x'.repeat(2048));
    const t = new Date(Date.now() - ageMs);
    utimesSync(f, t, t);
    return f;
  };
  const cands = () => run().candidates.filter((c) => (c.kind as string) === 'pwcache');

  it('lists files idle over 6 h with size and reason, keeps fresh ones', () => {
    const oldFile = entry('ab/cd-old.js', 7 * HOUR);
    const fresh = entry('ab/cd-new.js', 1 * HOUR);
    const [c] = cands() as [{ path: string; kb: number; reason: string; kind: string }];
    expect(c.path).toBe(cacheDir());
    expect(c.kb).toBeGreaterThan(0);
    expect(c.reason).toContain('1 Playwright transform-cache files');
    expect(remove(c as Candidate, { repo })).toBe('');
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(cacheDir())).toBe(true);
  });

  it('no candidate when every file is fresh or the dir is missing', () => {
    expect(cands()).toEqual([]);
    entry('ab/new.js', 1 * HOUR);
    expect(cands()).toEqual([]);
  });
});
