// Activity signals for housekeep (WP-139.1): how recently was a worktree used, and does its branch
// have work of its own. Reads only.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { listOf, statOf } from './housekeep.fs.mjs';

export const SCAN_LIMIT = 20_000; // entries the activity scan reads before it gives up and keeps
const SKIP_DIRS = new Set(['node_modules', '.git']);

export const git = (args, cwd) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export const gitOk = (args, cwd) => {
  try {
    git(args, cwd);
    return true;
  } catch {
    return false;
  }
};

const lines = (text) => text.split('\n').filter(Boolean);
const mtimeOf = (path) => statOf(path)?.mtimeMs ?? 0;

/** Newest mtime of any file or directory under `root`, skipping node_modules and .git. Bounded. */
export function newestMtime(root, limit = SCAN_LIMIT) {
  let newest = 0;
  let seen = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    const entries = listOf(dir, { withFileTypes: true });
    if (!entries) continue; // vanished mid-scan; any other error throws
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue; // .git is a file in a worktree
      if (++seen > limit) return { newest, truncated: true };
      const path = join(dir, e.name);
      newest = Math.max(newest, mtimeOf(path));
      if (e.isDirectory()) stack.push(path);
    }
  }
  return { newest, truncated: false };
}

/** The newest sign of life: the index, the HEAD reflog, and any file under the worktree. */
export function lastActivity(w) {
  const gitdir = git(['rev-parse', '--absolute-git-dir'], w.path).trim();
  const scan = newestMtime(w.path);
  const signals = [
    ['index touched', mtimeOf(join(gitdir, 'index'))],
    ['HEAD reflog written', mtimeOf(join(gitdir, 'logs', 'HEAD'))],
    ['a file changed', scan.newest],
  ];
  const [what, at] = signals.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { what, at, truncated: scan.truncated };
}

/** True when HEAD has moved since the worktree was created (a fresh branch has not). */
export function hasOwnCommits(w) {
  try {
    const birth = lines(git(['reflog', 'show', '--format=%H', 'HEAD'], w.path)).pop();
    return Boolean(birth) && birth !== w.head;
  } catch {
    return false;
  }
}
