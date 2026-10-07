import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
import { addWorktree, run, setupEnv, teardownEnv } from './housekeep.fixture';

let base: string;
let repo: string;
let tmp: string;
beforeEach(() => {
  ({ base, repo, tmp } = setupEnv());
});
afterEach(teardownEnv);

const LOCK = JSON.stringify({ lockfileVersion: 3, packages: {} });
const TS = ['node_modules', 'typescript', 'lib', 'typescript.js'];
const outside = () => join(base, 'outside');
const kinds = (kind: string) => run().candidates.filter((c) => c.kind === kind);

function install(dir: string) {
  writeFileSync(join(dir, 'package-lock.json'), LOCK);
  mkdirSync(join(dir, ...TS.slice(0, -1)), { recursive: true });
  writeFileSync(join(dir, ...TS), 'ts');
  writeFileSync(join(dir, 'node_modules', '.package-lock.json'), LOCK);
}
const hashDir = (root: string, name: string, ageS: number) => {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, 'm.js'), 'x'.repeat(4096));
  const t = new Date(Date.now() - ageS * 1000);
  utimesSync(join(root, name), t, t);
};
const sparse = (file: string, mb: number) => {
  writeFileSync(file, '');
  truncateSync(file, mb * 1024 * 1024);
};

describe('housekeep symlink safety', () => {
  it('a symlinked vitest-modules pointing outside yields nothing and the target stays', () => {
    for (const n of ['a1', 'b2', 'c3', 'd4']) mkdirSync(join(outside(), n), { recursive: true });
    mkdirSync(join(repo, 'node_modules', '.cache'), { recursive: true });
    symlinkSync(outside(), join(repo, 'node_modules', '.cache', 'vitest-modules'));
    expect(run().candidates).toEqual([]);
    expect(existsSync(join(outside(), 'a1'))).toBe(true);
  });

  it('a symlinked node_modules in a worktree yields nothing', () => {
    const w = addWorktree('lnk');
    for (const n of ['a1', 'b2', 'c3'])
      mkdirSync(join(outside(), '.cache', 'vitest-modules', n), { recursive: true });
    symlinkSync(outside(), join(w, 'node_modules'));
    expect(kinds('vitest-cache')).toEqual([]);
  });

  it('a symlinked hash dir is never a candidate', () => {
    const root = join(repo, 'node_modules', '.cache', 'vitest-modules');
    hashDir(root, 'b1', 100);
    hashDir(root, 'b2', 50);
    mkdirSync(join(outside(), 'real'), { recursive: true });
    symlinkSync(join(outside(), 'real'), join(root, 'b0'));
    expect(kinds('vitest-cache')).toEqual([]);
  });

  it('a symlinked node-compile-cache is not a candidate', () => {
    mkdirSync(join(outside(), 'cache'), { recursive: true });
    sparse(join(outside(), 'cache', 'blob'), 300);
    symlinkSync(join(outside(), 'cache'), join(tmp, 'node-compile-cache'));
    expect(run().candidates).toEqual([]);
    expect(existsSync(join(outside(), 'cache', 'blob'))).toBe(true);
  });
});

describe('housekeep dry run of the new kinds', () => {
  it('lists cache, copy and vitest-cache with sizes and changes nothing', () => {
    install(repo);
    install(addWorktree('dry'));
    mkdirSync(join(tmp, 'node-compile-cache'));
    sparse(join(tmp, 'node-compile-cache', 'blob'), 201);
    const root = join(repo, 'node_modules', '.cache', 'vitest-modules');
    hashDir(root, 'a1', 300);
    hashDir(root, 'b2', 200);
    hashDir(root, 'c3', 100);
    const snap = () =>
      execFileSync('find', [base, '-not', '-path', '*/.git/*', '-printf', '%p %s %n\\n'], {
        encoding: 'utf8',
        env: specEnv(),
      });
    const before = snap();
    const r = spawnSync('node', [join(process.cwd(), 'scripts/ops/housekeep.mjs')], {
      cwd: repo,
      encoding: 'utf8',
      env: specEnv({ TMPDIR: tmp }),
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('mode: dry run');
    for (const kind of ['cache', 'copy', 'vitest-cache'])
      expect(r.stdout).toMatch(new RegExp(`^  ${kind}\\s+\\S+.*\\d+ (MB|GB)`, 'm'));
    expect(snap()).toBe(before);
  });
});
