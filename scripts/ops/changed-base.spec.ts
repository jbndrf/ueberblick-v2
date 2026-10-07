import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
import { mergeBase, recordedSelection, vitestArgs } from './changed-base.mjs';

// WP-955 contract 1: `test:changed` diffs against the merge-base with main, not main's tip.
describe('changed base (merge-base with main)', () => {
  let dir: string;
  let branchPoint: string;
  const env = specEnv({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' });
  const git = (...a: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], {
      cwd: dir,
      env,
      encoding: 'utf8',
    }).trim();
  const commit = (file: string, text: string) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
    git('add', '-A');
    git('commit', '-qm', file);
  };
  /** What vitest's `--changed <sha>` lists: the diff against sha (committed, staged, unstaged) plus untracked files. */
  const changedSince = (sha: string) =>
    [
      ...git('diff', '--name-only', sha).split('\n'),
      ...git('ls-files', '--others', '--exclude-standard').split('\n'),
    ]
      .filter(Boolean)
      .sort();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'changed-base-'));
    git('init', '-q', '-b', 'main');
    commit('base.txt', 'base');
    branchPoint = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'wp/x');
    commit('packages/ui/src/own.ts', 'own');
    git('checkout', '-q', 'main');
    commit('scripts/landed-later.mjs', 'later'); // main moves on after the branch point
    commit('apps/web/messages/de.json', '{}');
    git('checkout', '-q', 'wp/x');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('the base of a branch behind main is the branch point, not main', () => {
    expect(mergeBase(dir, 'main')).toBe(branchPoint);
    expect(mergeBase(dir, 'main')).not.toBe(git('rev-parse', 'main'));
  });

  it('a branch behind main sees only its own changes, not what main changed since', () => {
    expect(changedSince(mergeBase(dir, 'main'))).toEqual(['packages/ui/src/own.ts']);
    // the old base (main's tip) would have listed main's newer files too
    expect(changedSince('main')).toEqual(
      expect.arrayContaining(['scripts/landed-later.mjs', 'apps/web/messages/de.json']),
    );
  });

  it('uncommitted and untracked changes count on top of the merge-base', () => {
    writeFileSync(join(dir, 'base.txt'), 'edited');
    writeFileSync(join(dir, 'new.ts'), 'new');
    expect(changedSince(mergeBase(dir, 'main'))).toEqual(['base.txt', 'new.ts', 'packages/ui/src/own.ts']);
    git('checkout', '-q', '--', 'base.txt');
    rmSync(join(dir, 'new.ts'));
  });

  it('on main itself the merge-base is HEAD, so only uncommitted changes count', () => {
    git('checkout', '-q', 'main');
    expect(mergeBase(dir, 'main')).toBe(git('rev-parse', 'HEAD'));
    expect(changedSince(mergeBase(dir, 'main'))).toEqual([]);
    writeFileSync(join(dir, 'base.txt'), 'edited');
    expect(changedSince(mergeBase(dir, 'main'))).toEqual(['base.txt']);
    git('checkout', '-q', '--', 'base.txt');
    git('checkout', '-q', 'wp/x');
  });

  it("vitestArgs: related files come from the merge-base diff, not main's newer files", async () => {
    const { argv } = await vitestArgs(['--changed', 'main', '--passWithNoTests'], dir);
    expect(argv[0]).toBe('related');
    expect(argv).toContain('packages/ui/src/own.ts');
    expect(argv).not.toContain('scripts/landed-later.mjs');
    expect(argv).toEqual(expect.arrayContaining(['--run', '--passWithNoTests']));
    expect(argv).not.toContain('--changed');
  });

  // WP-1006: every scoped run records why it selected what it ran.
  it('vitestArgs selection: a trigger records all with the deciding line as the reason', async () => {
    const plan = await vitestArgs(['--changed', 'main'], dir, { files: ['package-lock.json'], deleted: [] });
    expect(recordedSelection(plan)).toEqual({
      all: true,
      reason: 'trigger package-lock.json -> all tests',
      seeds: 0,
    });
  });

  it('vitestArgs selection: related files record their number as seeds', async () => {
    const plan = await vitestArgs(['--changed', 'main'], dir, {
      files: ['packages/ui/src/own.ts', 'packages/ui/src/two.ts'],
      deleted: [],
    });
    expect(recordedSelection(plan)).toEqual({ all: false, reason: 'related', seeds: 2 });
  });

  it('recordedSelection: a missing hand-off is recorded as unknown, never a crash', () => {
    expect(recordedSelection(undefined)).toEqual({ all: false, reason: 'unknown', seeds: 0 });
    expect(recordedSelection({ argv: ['run'], lines: [] })).toEqual({
      all: false,
      reason: 'unknown',
      seeds: 0,
    });
  });

  it('vitestArgs: without --changed it is a plain run', async () => {
    expect(await vitestArgs(['packages/core'], dir)).toEqual({ argv: ['run', 'packages/core'], lines: [] });
  });

  it('a deleted file no spec imported selects nothing but says so; a rename counts as the old path deleted', async () => {
    git('rm', '-q', 'base.txt');
    const plan = await vitestArgs(['--changed', 'main'], dir);
    expect(plan.argv[0]).toBe('related');
    expect(plan.lines[0]).toBe('deleted base.txt -> 0 specs that imported it');
    git('reset', '-q', '--hard');
    git('mv', 'base.txt', 'renamed.txt');
    expect((await vitestArgs(['--changed', 'main'], dir)).lines[0]).toBe(
      'deleted base.txt -> 0 specs that imported it',
    );
    git('reset', '-q', '--hard');
  });

  it('a deleted source file selects the specs that imported it at the merge-base (WP-991)', async () => {
    git('checkout', '-q', 'main');
    commit('packages/ui/src/lib.ts', 'export const lib = 1;');
    commit('packages/ui/src/lib.spec.ts', "import { lib } from './lib';\nvoid lib;");
    git('checkout', '-q', '-b', 'wp/y');
    git('rm', '-q', 'packages/ui/src/lib.ts');
    const plan = await vitestArgs(['--changed', 'main'], dir);
    expect(plan.argv.slice(0, 2)).toEqual(['related', 'packages/ui/src/lib.spec.ts']);
    expect(plan.lines[0]).toBe('deleted packages/ui/src/lib.ts -> 1 specs that imported it');
    git('reset', '-q', '--hard');
  });

  it('deleting a spec selects nothing extra', async () => {
    commit('packages/ui/src/x.spec.ts', 'x');
    git('rm', '-q', 'packages/ui/src/x.spec.ts');
    const plan = await vitestArgs(['--changed', 'main'], dir);
    expect(plan.argv[0]).toBe('related');
    git('reset', '-q', '--hard');
  });

  describe('compiled messages missing (fresh worktree)', () => {
    const setup = (writes: boolean, pkg = 'packages/ui') => {
      commit(`${pkg}/project.inlang/settings.json`, '{}');
      commit(
        `${pkg}/vitest.global-setup.ts`,
        `import { mkdirSync, writeFileSync } from 'node:fs';
export default function setup(): void {
  ${writes ? "mkdirSync('packages/ui/src/paraglide', { recursive: true }); writeFileSync('packages/ui/src/paraglide/messages.js', '');" : ''}
}
`,
      );
    };
    const changes = { files: ['packages/ui/messages/de.json'], deleted: [] };

    it('compiles first, then selects the importers of the entry', async () => {
      setup(true);
      const cwd = process.cwd();
      process.chdir(dir);
      try {
        const plan = await vitestArgs(['--changed', 'main'], dir, changes);
        expect(plan.argv[0]).toBe('related');
        expect(plan.argv).toContain('packages/ui/src/paraglide/messages.js');
      } finally {
        process.chdir(cwd);
      }
    });

    it('compiles a package without a global setup with its own i18n script (WP-989)', async () => {
      const compile =
        "node -e \"const f=require('fs');f.mkdirSync('src/paraglide',{recursive:true});f.writeFileSync('src/paraglide/messages.js','')\"";
      commit(
        'packages/tools/zeta/package.json',
        JSON.stringify({ scripts: { i18n: `${compile} -- --outdir ./src/paraglide` } }),
      );
      commit('packages/tools/zeta/project.inlang/settings.json', '{}');
      const plan = await vitestArgs(['--changed', 'main'], dir, {
        files: ['packages/tools/zeta/messages/de.json'],
        deleted: [],
      });
      expect(plan.argv[0]).toBe('related');
      expect(plan.argv).toContain('packages/tools/zeta/src/paraglide/messages.js');
    });

    it('falls back to every test when the entry is still missing, and says why', async () => {
      // another package: vitest caches a module by path, so the same setup file cannot change its behaviour
      setup(false, 'apps/web');
      const cwd = process.cwd();
      process.chdir(dir);
      try {
        const plan = await vitestArgs(['--changed', 'main'], dir, {
          files: ['apps/web/messages/de.json'],
          deleted: [],
        });
        expect(plan.argv[0]).toBe('run');
        expect(plan.lines.join('\n')).toContain(
          'compiled messages of apps/web missing after compile -> all tests',
        );
      } finally {
        process.chdir(cwd);
      }
    });
  });
});
