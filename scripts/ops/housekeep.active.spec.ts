import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addWorktree,
  ageWorktree,
  git,
  HOUR,
  old,
  realPath,
  run,
  setupEnv,
  teardownEnv,
  wt,
} from './housekeep.fixture';
import { newestMtime } from './housekeep.mjs';

let repo: string;
// A fresh repo per test and per repeat: a failing or repeated test must not see what another left behind.
beforeEach(() => {
  ({ repo } = setupEnv());
});
afterEach(teardownEnv);

describe('housekeep active-worktree safety (WP-139.1)', () => {
  const only = (name: string) => {
    const r = run();
    const p = realPath(wt(name));
    return {
      candidate: r.candidates.find((c) => c.path === p),
      kept: r.skipped.find((s) => s.path === p)?.reason,
    };
  };

  it('keeps a fresh worktree with no commits whose index was touched 5 minutes ago', () => {
    const d = addWorktree('fresh-idx', { fresh: true });
    old(join(git(d, 'rev-parse', '--absolute-git-dir').trim(), 'index'), 5 * 60_000);
    expect(only('fresh-idx')).toEqual({
      candidate: undefined,
      kept: 'wp/fresh-idx has no commits of its own yet',
    });
    git(repo, 'worktree', 'remove', d);
  });

  it('never proposes a worktree whose tip equals its fork point, whatever its age', () => {
    const d = addWorktree('fresh-old', { fresh: true });
    ageWorktree(d, 30 * 24 * HOUR);
    const det = addWorktree('fresh-det', { fresh: true, detach: true });
    ageWorktree(det, 30 * 24 * HOUR);
    expect(only('fresh-old').candidate).toBeUndefined();
    expect(only('fresh-det').kept).toBe('detached HEAD has no commits of its own yet');
    expect(run().candidates.filter((c) => c.kind === 'worktree')).toEqual([]);
    git(repo, 'worktree', 'remove', d);
    git(repo, 'worktree', 'remove', det);
  });

  it('proposes a landed wp/* worktree (events log says merged) that is idle over 2 h', () => {
    const d = addWorktree('WP-900', { fresh: true, branch: 'wp/WP-900' });
    expect(only('WP-900').candidate).toBeUndefined(); // no own commits, no landing yet
    mkdirSync(join(repo, 'work', 'events'), { recursive: true });
    writeFileSync(
      join(repo, 'work', 'events', 'WP-900.log'),
      '2026-09-30 10:00 start\n2026-09-30 11:00 merged abc1234\n',
    );
    git(repo, 'add', 'work');
    git(repo, 'commit', '-q', '-m', 'events');
    const c = only('WP-900').candidate;
    expect(c?.reason).toMatch(/merged into main, clean, idle over 2 h/);
    git(repo, 'worktree', 'remove', d);
  });

  it('keeps a merged worktree while a nested file changed in the last 2 h', () => {
    const d = addWorktree('nested');
    mkdirSync(join(d, 'packages', 'a', 'src'), { recursive: true });
    writeFileSync(join(d, 'packages', 'a', 'src', 'x.ts'), 'x');
    old(join(d, 'packages', 'a', 'src', 'x.ts'), 60_000);
    // the file is untracked, so this is also dirty; ignore it to isolate the activity signal
    writeFileSync(join(d, '.git-info-exclude-placeholder'), '');
    git(d, 'add', '.');
    git(d, 'commit', '-q', '-m', 'nested');
    old(join(git(d, 'rev-parse', '--absolute-git-dir').trim(), 'index'), 3 * HOUR);
    old(join(git(d, 'rev-parse', '--absolute-git-dir').trim(), 'logs', 'HEAD'), 3 * HOUR);
    git(repo, 'merge', '-q', '--ff-only', git(d, 'rev-parse', 'HEAD').trim());
    expect(only('nested').kept).toBe('active in the last 2 h (a file changed)');
    ageWorktree(d, 3 * HOUR);
    expect(only('nested').candidate).toBeDefined();
    git(repo, 'worktree', 'remove', d);
  });

  it('keeps a merged worktree whose HEAD reflog or index is recent', () => {
    const d = addWorktree('recent-idx');
    const gitdir = git(d, 'rev-parse', '--absolute-git-dir').trim();
    old(join(gitdir, 'index'), 10 * 60_000);
    expect(only('recent-idx').kept).toBe('active in the last 2 h (index touched)');
    old(join(gitdir, 'index'), 3 * HOUR);
    old(join(gitdir, 'logs', 'HEAD'), 10 * 60_000);
    expect(only('recent-idx').kept).toBe('active in the last 2 h (HEAD reflog written)');
    git(repo, 'worktree', 'remove', d);
  });

  it('ignores node_modules and bounds the scan', () => {
    const d = addWorktree('bounded');
    // the scan limit of 2 must be exceeded by this worktree alone, not by files earlier tests merged into main
    for (const f of ['a.txt', 'b.txt', 'c.txt']) writeFileSync(join(d, f), 'x');
    git(d, 'add', '.');
    git(d, 'commit', '-q', '-m', 'more files');
    git(repo, 'merge', '-q', '--ff-only', git(d, 'rev-parse', 'HEAD').trim());
    ageWorktree(d, 3 * HOUR);
    mkdirSync(join(d, 'node_modules', 'p'), { recursive: true });
    writeFileSync(join(d, 'node_modules', 'p', 'f.js'), 'x');
    expect(only('bounded').candidate).toBeDefined(); // fresh node_modules content does not count
    expect(newestMtime(d, 2).truncated).toBe(true);
    expect(newestMtime(d).truncated).toBe(false);
    git(repo, 'worktree', 'remove', '--force', d);
  });
});
