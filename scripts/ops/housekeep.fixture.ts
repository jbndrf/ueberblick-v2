import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { specEnv } from '../testing/spec-env.mjs';
import { plan, type Candidate } from './housekeep.mjs';

// Shared by the housekeep specs. Every test runs against a repo and a tmp dir created here.
// Nothing touches the real /tmp or the real repo.
export const HOUR = 3_600_000;
type Env = { base: string; repo: string; tmp: string };
let env: Env = { base: '', repo: '', tmp: '' };

export const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: specEnv({
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    }),
  });

export function setupEnv(): Env {
  const base = mkdtempSync(join(tmpdir(), 'housekeep-test-'));
  const repo = join(base, 'repo');
  const tmp = join(base, 'tmp');
  mkdirSync(repo);
  mkdirSync(tmp);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  mkdirSync(join(repo, 'metrics', 'raw', 'logwatch'), { recursive: true });
  mkdirSync(join(repo, 'reference'));
  writeFileSync(join(repo, 'reference', 'v3.md'), 'v3');
  env = { base, repo, tmp };
  return env;
}
export function teardownEnv() {
  git(env.repo, 'worktree', 'prune');
  rmSync(env.base, { recursive: true, force: true });
}

export const wt = (name: string) => join(env.repo, '.claude', 'worktrees', name);
export const realPath = (p: string) => execFileSync('realpath', [p], { encoding: 'utf8' }).trim();
export const old = (path: string, ageMs: number) => {
  const t = new Date(Date.now() - ageMs);
  utimesSync(path, t, t);
};
const stamp = (path: string, t: Date) => utimesSync(path, t, t);
/** Sets the mtime of a path and everything below it (not .git), like a worktree left idle. */
const ageTree = (dir: string, t: Date) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) ageTree(p, t);
    else stamp(p, t);
  }
  stamp(dir, t);
};
/** Ages a whole worktree: its files, its index and its HEAD reflog, all to ONE timestamp. */
export const ageWorktree = (dir: string, ageMs: number) => {
  const t = new Date(Date.now() - ageMs);
  ageTree(dir, t);
  const gitdir = git(dir, 'rev-parse', '--absolute-git-dir').trim();
  stamp(join(gitdir, 'index'), t);
  stamp(join(gitdir, 'logs', 'HEAD'), t);
};
/**
 * A worktree on a new branch, made old. By default the branch has a commit of its own that main
 * now contains (merged). `merged` false leaves that commit out of main. `fresh` adds no commit.
 */
export function addWorktree(
  name: string,
  opts: { merged?: boolean; branch?: string; detach?: boolean; fresh?: boolean } = {},
) {
  const { repo } = env;
  const dir = wt(name);
  const branch = opts.branch ?? `wp/${name}`;
  if (opts.detach) git(repo, 'worktree', 'add', '--detach', dir, 'main');
  else git(repo, 'worktree', 'add', '-b', branch, dir, 'main');
  if (!opts.fresh) {
    writeFileSync(join(dir, `${name}.txt`), 'work');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', name);
    if (opts.merged !== false) git(repo, 'merge', '-q', '--ff-only', git(dir, 'rev-parse', 'HEAD').trim());
  }
  ageWorktree(dir, 3 * HOUR);
  return dir;
}
export const paths = (cs: Candidate[]) => cs.map((c) => c.path ?? c.branch).sort();
export const run = (extra: Record<string, unknown> = {}) =>
  plan({ repo: env.repo, tmp: env.tmp, procCwds: () => [], cwd: env.base, ...extra });
