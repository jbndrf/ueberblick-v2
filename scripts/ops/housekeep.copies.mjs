// Housekeep candidates for the two things that filled the disk on 2026-10-02 (WP-972):
// Node's compile cache in the tmp dir, and real node_modules copies that could be hardlinks.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { listOf, statOf } from './housekeep.fs.mjs';
import { ensureNodeModules, linkRefusal } from './link-node-modules.mjs';
import { lockHash } from './vitest-cache.mjs';

export const CACHE_MIN_KB = 200 * 1024;
const SAMPLE = join('node_modules', 'typescript', 'lib', 'typescript.js');

const apparentKb = (path) => {
  try {
    return Number(execFileSync('du', ['-sk', '--apparent-size', path], { encoding: 'utf8' }).split(/\s/)[0]);
  } catch {
    return 0;
  }
};

/** A real directory (lstat, never a symlink). */
const plainDir = (p) => {
  try {
    const st = lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * True when every component of `parts` below `base` is a real directory and the end really lies under
 * `base`. rmSync would otherwise delete inside a symlink's target.
 */
function plainChain(base, ...parts) {
  let cur = base;
  for (const part of parts) {
    cur = join(cur, part);
    if (!plainDir(cur)) return false;
  }
  try {
    return realpathSync(cur).startsWith(realpathSync(base) + sep);
  } catch {
    return false;
  }
}

/** `<tmp>/node-compile-cache` when over 200 MB. Node rebuilds it on demand. Nothing else in tmp. */
export function cacheCandidates(o) {
  if (!o.tmp || !isAbsolute(o.tmp)) return [];
  const dir = join(o.tmp, 'node-compile-cache');
  if (!plainChain(o.tmp, 'node-compile-cache')) return [];
  const kb = apparentKb(dir);
  if (kb <= CACHE_MIN_KB) return [];
  return [
    {
      kind: 'cache',
      path: dir,
      base: o.tmp,
      parts: ['node-compile-cache'],
      kb,
      reason: 'Node compile cache over 200 MB, rebuilt on demand',
    },
  ];
}

const isRealCopy = (dir) => {
  try {
    return statSync(join(dir, SAMPLE)).nlink === 1;
  } catch {
    return false; // no node_modules or no sample file: nothing to relink
  }
};

function docsyncDirs(repo) {
  const parent = dirname(repo);
  const prefix = `${basename(repo)}-docsync-`;
  try {
    return readdirSync(parent)
      .filter((n) => n.startsWith(prefix))
      .map((n) => join(parent, n));
  } catch {
    return [];
  }
}

const HEX = /^[0-9a-f]+$/;

const KEEP_NEWEST = 2;
export const CACHE_SOFT_MB = 1024;
export const ENTRY_MAX_AGE_MS = 24 * 3_600_000;
export const ENTRY_MIN_AGE_MS = 3_600_000;

/** Every file under `dir` with its size and mtime: readdir with file types plus one lstat each. */
function entriesOf(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of listOf(d, { withFileTypes: true }) ?? []) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        const st = statOf(p);
        if (st) out.push({ p, size: st.size, t: st.mtimeMs });
      }
    }
  }
  return out;
}

/**
 * The active hash dir over `softMb`: its entries older than 24 h (never younger than 1 h), oldest first, until the
 * dir is under the limit. One candidate with the files, not one per file (WP-999).
 */
function trimCandidate(dir, parts, hashDir, o) {
  const softBytes = (o.cacheSoftMb ?? CACHE_SOFT_MB) * 1024 * 1024;
  const all = entriesOf(hashDir);
  let total = all.reduce((n, e) => n + e.size, 0);
  if (total <= softBytes) return null;
  const cutoff = o.now - Math.max(ENTRY_MAX_AGE_MS, ENTRY_MIN_AGE_MS);
  const old = all.filter((e) => e.t < cutoff).sort((a, b) => a.t - b.t);
  const files = [];
  let freed = 0;
  for (const e of old) {
    if (total - freed <= softBytes) break;
    files.push(e.p);
    freed += e.size;
  }
  if (!files.length) return null;
  const mb = Math.round(freed / 1048576);
  return {
    kind: 'vitest-cache',
    path: hashDir,
    base: dir,
    parts,
    files,
    cutoff,
    kb: Math.round(freed / 1024),
    report: `vitest module cache: ${hashDir} ${files.length} entries, ${mb} MB freed`,
    reason: `${files.length} entries unused for 24 h, ${mb} MB (dir over ${o.cacheSoftMb ?? CACHE_SOFT_MB} MB)`,
  };
}

/** Every checkout that may hold a vitest module cache: main, worktrees, `-land`, `-docsync-*`. */
function checkouts(o, worktrees) {
  const main = o.repo;
  const all = [main, `${main}-land`, ...worktrees.map((w) => w.path), ...docsyncDirs(main)];
  return [...new Set(all.map((p) => resolve(p)))];
}

export const VITEST_CACHE_IDLE_MS = 3 * 3_600_000;

/** True when nothing under `root` (a file or a directory) changed after `cutoff`. Stops at the first newer entry. */
function idleSince(root, cutoff) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    if ((statOf(dir)?.mtimeMs ?? 0) > cutoff) return false;
    for (const e of listOf(dir, { withFileTypes: true }) ?? []) {
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if ((statOf(p)?.mtimeMs ?? 0) > cutoff) return false;
    }
  }
  return true;
}

/**
 * `node_modules/.cache/vitest-modules/<lockHash>` dirs. Main and `<main>-land` keep only the dir of the current
 * lockfile (WP-999: every other hash dir goes, and the active dir loses entries unused for 24 h while over 1 GB). Any other checkout loses the whole cache when idle over 3 h or when `isMerged(worktree)`
 * (WP-993: agent worktrees run the cache, so it must not pile up behind them).
 */
export function vitestCacheCandidates(o, worktrees, isMerged = () => false) {
  const found = [];
  const longLived = new Set([resolve(o.repo), resolve(`${o.repo}-land`)]);
  for (const dir of checkouts(o, worktrees)) {
    if (!plainChain(dir, 'node_modules', '.cache', 'vitest-modules')) continue;
    const root = join(dir, 'node_modules', '.cache', 'vitest-modules');
    if (!longLived.has(dir)) {
      const w = worktrees.find((x) => resolve(x.path) === dir);
      const idle = idleSince(root, o.now - VITEST_CACHE_IDLE_MS);
      if (idle || (w && isMerged(w))) {
        const reason = idle ? 'vitest module cache idle over 3 h' : 'vitest module cache of a merged branch';
        const parts = ['node_modules', '.cache', 'vitest-modules'];
        found.push({ kind: 'vitest-cache', path: root, base: dir, parts, kb: apparentKb(root), reason });
        continue;
      }
    }
    let names;
    try {
      names = readdirSync(root).filter((n) => HEX.test(n));
    } catch {
      continue;
    }
    if (!longLived.has(dir)) {
      // worktrees (WP-993): all but the two newest hash dirs
      const dated = [];
      for (const n of names) {
        const st = statOf(join(root, n));
        if (st?.isDirectory()) dated.push({ n, t: st.mtimeMs });
      }
      dated.sort((a, b) => b.t - a.t);
      for (const { n } of dated.slice(KEEP_NEWEST)) {
        const path = join(root, n);
        const reason = 'old vitest module cache (not one of the 2 newest lockfile hashes)';
        const parts = ['node_modules', '.cache', 'vitest-modules', n];
        found.push({ kind: 'vitest-cache', path, base: dir, parts, kb: apparentKb(path), reason });
      }
      continue;
    }
    const current = lockHash(dir);
    if (!current) continue; // no lockfile to name the active dir: prune nothing
    for (const n of names) {
      const path = join(root, n);
      const st = statOf(path);
      if (n === current || !st?.isDirectory()) continue;
      const reason = 'old vitest module cache (not the current lockfile hash)';
      const parts = ['node_modules', '.cache', 'vitest-modules', n];
      found.push({ kind: 'vitest-cache', path, base: dir, parts, kb: apparentKb(path), reason });
    }
    const active = join(root, current);
    if (names.includes(current) && plainChain(root, current)) {
      const t = trimCandidate(dir, ['node_modules', '.cache', 'vitest-modules', current], active, o);
      if (t) found.push(t);
    }
  }
  return found;
}

/** Worktrees (and `<main>-docsync-*` dirs) whose node_modules is a real copy that main's install could replace. */
export function copyCandidates(o, worktrees, skipped) {
  const cwds = [realpathSync(o.cwd), ...o.procCwds()];
  const main = o.repo;
  const dirs = new Set([...worktrees.map((w) => w.path), ...docsyncDirs(main)].map((p) => resolve(p)));
  const found = [];
  for (const dir of dirs) {
    if (dir === main || dir === `${main}-land` || !existsSync(dir)) continue;
    if (!plainDir(join(dir, 'node_modules')) || !isRealCopy(dir)) continue;
    let refusal;
    try {
      refusal = linkRefusal(dir, main);
    } catch {
      continue;
    }
    if (refusal) continue;
    const real = realpathSync(dir);
    if (cwds.some((c) => c === real || c.startsWith(real + sep))) {
      // A relink empties node_modules for a moment: a false red in a running check costs more than the space.
      skipped.push({ kind: 'copy', path: dir, reason: 'a live process works inside it' });
      continue;
    }
    found.push({
      kind: 'copy',
      path: dir,
      kb: apparentKb(join(dir, 'node_modules')),
      reason: "real node_modules copy, package-lock.json equals main's: relink as hardlinks",
    });
  }
  return found;
}

/** Applies a cache or copy candidate. Never runs npm ci. Throws on failure. */
export function removeCopyKind(c, repo) {
  if (c.files) {
    if (!plainChain(c.base, ...c.parts)) throw new Error('a path component is no longer a plain directory');
    for (const f of c.files) {
      const st = statOf(f);
      if (st && st.mtimeMs < c.cutoff) rmSync(f, { force: true }); // rewritten since planning: keep
    }
    return;
  }
  if (c.kind === 'cache' || c.kind === 'vitest-cache') {
    // Planning and applying are not atomic: re-check that nothing on the way became a symlink.
    if (!plainChain(c.base, ...c.parts)) throw new Error('a path component is no longer a plain directory');
    return rmSync(c.path, { recursive: true, force: true });
  }
  const r = ensureNodeModules({ worktree: c.path, main: repo, replace: true, npmCi: () => 1 });
  if (r.action !== 'linked') throw new Error(`relink did not link: ${r.action} (${r.reason})`);
}
