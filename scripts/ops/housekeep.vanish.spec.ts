import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fsx } from './housekeep.fs.mjs';
import { addWorktree, HOUR, old, run as runFixture, setupEnv, teardownEnv } from './housekeep.fixture';
import { newestMtime, plan } from './housekeep.mjs';

// WP-916: an entry that vanishes between listing and stat is skipped, anything else still throws.
let repo: string;
let tmp: string;
const real = { lstat: fsx.lstat, readdir: fsx.readdir };
// A fresh repo per test and per repeat: a failing or repeated test must not see what another left behind.
beforeEach(() => {
  ({ repo, tmp } = setupEnv());
});
afterEach(teardownEnv);
afterEach(() => {
  fsx.lstat = real.lstat;
  fsx.readdir = real.readdir;
});

const fail = (code: string) => Object.assign(new Error(code), { code });
const now = Date.now();
const run = () => plan({ repo, tmp, now, cwd: repo, procCwds: () => [] });

/** Makes lstat of paths ending in `suffix` fail with `code`, once the listing already happened. */
const breakLstat = (suffix: string, code: string) => {
  fsx.lstat = ((p: string) => {
    if (p.endsWith(suffix)) throw fail(code);
    return real.lstat(p);
  }) as typeof fsx.lstat;
};

describe('housekeep tolerates vanishing entries', () => {
  for (const code of ['ENOENT', 'ENOTDIR']) {
    it(`tmp scan: lstat ${code} skips the entry`, () => {
      const leak = join(tmp, 'abcdefghij0123456789A');
      mkdirSync(join(leak, 'client'), { recursive: true });
      old(leak, 20 * 60_000);
      expect(run().candidates.map((c) => c.path)).toContain(leak);
      breakLstat('0123456789A', code);
      expect(run().candidates.map((c) => c.path)).not.toContain(leak);
    });

    it(`tmp scan: readdir ${code} of the entry skips it`, () => {
      const leak = join(tmp, 'abcdefghij0123456789B');
      mkdirSync(join(leak, 'client'), { recursive: true });
      old(leak, 20 * 60_000);
      fsx.readdir = ((p: string, o?: object) => {
        if (p === leak) throw fail(code);
        return real.readdir(p, o as never);
      }) as typeof fsx.readdir;
      expect(run().candidates.map((c) => c.path)).not.toContain(leak);
    });

    it(`log scan: lstat ${code} skips the report`, () => {
      const f = join(repo, 'metrics', 'raw', 'logwatch', 'gone.md');
      writeFileSync(f, 'x');
      utimesSync(f, new Date(now - 8 * 24 * HOUR), new Date(now - 8 * 24 * HOUR));
      expect(run().candidates.map((c) => c.path)).toContain(f);
      breakLstat('gone.md', code);
      expect(run().candidates.map((c) => c.path)).not.toContain(f);
      rmSync(f);
    });

    it(`activity scan: lstat and readdir ${code} are skipped`, () => {
      const root = join(tmp, 'act');
      mkdirSync(join(root, 'sub'), { recursive: true });
      writeFileSync(join(root, 'sub', 'f'), 'x');
      fsx.readdir = ((p: string, o?: object) => {
        if (p.endsWith('sub')) throw fail(code);
        return real.readdir(p, o as never);
      }) as typeof fsx.readdir;
      expect(newestMtime(root).truncated).toBe(false);
      breakLstat('sub', code);
      expect(() => newestMtime(root)).not.toThrow();
    });
  }

  it('a non-ENOENT error still throws (tmp and log listings)', () => {
    const leak = join(tmp, 'abcdefghij0123456789C');
    mkdirSync(join(leak, 'client'), { recursive: true });
    old(leak, 20 * 60_000);
    breakLstat('0123456789C', 'EACCES');
    expect(run).toThrow(/EACCES/);
    fsx.lstat = real.lstat;
    rmSync(leak, { recursive: true });

    const f = join(repo, 'metrics', 'raw', 'logwatch', 'deny.md');
    writeFileSync(f, 'x');
    breakLstat('deny.md', 'EACCES');
    expect(run).toThrow(/EACCES/);
    rmSync(f);
  });

  it('newestMtime itself throws on a non-vanish error', () => {
    const root = join(tmp, 'act2');
    mkdirSync(join(root, 'sub'), { recursive: true });
    breakLstat('sub', 'EACCES');
    expect(() => newestMtime(root)).toThrow(/EACCES/);
  });

  for (const [what, hit] of [
    ['a file in the worktree', '.txt'],
    ['the index', '/index'],
    ['the HEAD reflog', '/logs/HEAD'],
  ] as const) {
    it(`an unreadable ${what} keeps that worktree and does not crash plan`, () => {
      const dir = addWorktree(`WP-unreadable-${hit.replace(/\W/g, '')}`);
      const before = runFixture();
      expect(before.candidates.map((c) => c.path)).toContain(dir);
      fsx.lstat = ((p: string) => {
        if (p.endsWith(hit)) throw fail('EACCES');
        return real.lstat(p);
      }) as typeof fsx.lstat;
      const after = runFixture();
      expect(after.candidates.map((c) => c.path)).not.toContain(dir);
      expect(after.skipped.find((s) => s.path === dir)?.reason).toMatch(/activity unreadable: EACCES/);
    });
  }
});
