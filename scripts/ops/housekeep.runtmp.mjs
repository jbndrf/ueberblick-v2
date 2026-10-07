// Housekeep candidates for the per-run temp dirs that killed runs leave behind (WP-993):
// `<tmp>/vitest-XXXXXX` (vitest's TMPDIR per run) and `<tmp>/ueberblick-e2e-*` (e2e servers).
import { readdirSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { newestMtime } from './housekeep.activity.mjs';
import { listOf, statOf } from './housekeep.fs.mjs';

export const RUN_TMP_IDLE_MS = 6 * 3_600_000;
const RUN_TMP_NAME = /^(vitest-[A-Za-z0-9]{6}|ueberblick-e2e-.+)$/;

/** Working directories of all live processes (Linux): a worktree with one inside is in use. */
export function procCwdsDefault() {
  const out = [];
  try {
    for (const pid of readdirSync('/proc').filter((n) => /^\d+$/.test(n)))
      try {
        out.push(realpathSync(`/proc/${pid}/cwd`));
      } catch {
        /* process gone or not ours */
      }
  } catch {
    /* no /proc: the lock and age rules remain */
  }
  return out;
}

/** Targets of the cwd and every open fd of all live processes (Linux), so a dir that something still holds is kept. */
export function procOpenPathsDefault() {
  const out = [];
  let pids = [];
  try {
    pids = readdirSync('/proc').filter((n) => /^\d+$/.test(n));
  } catch {
    return out; /* no /proc: the age rule remains */
  }
  for (const pid of pids) {
    try {
      out.push(realpathSync(`/proc/${pid}/cwd`));
    } catch {
      /* gone or not ours */
    }
    let fds = [];
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds)
      try {
        out.push(readlinkSync(`/proc/${pid}/fd/${fd}`));
      } catch {
        /* closed meanwhile */
      }
  }
  return out;
}

const within = (dir, path) => path === dir || path.startsWith(dir + sep);

/** `isProtected` and `procOpenPaths` come from the caller (housekeep.mjs) to keep this file free of cycles. */
export function runTmpCandidates(o, isProtected, procOpenPaths = procOpenPathsDefault) {
  const old = [];
  for (const name of listOf(o.tmp) ?? []) {
    const dir = join(o.tmp, name);
    if (!RUN_TMP_NAME.test(name) || isProtected(dir, o.repo)) continue;
    const st = statOf(dir);
    if (!st?.isDirectory() || st.isSymbolicLink()) continue;
    const { newest, truncated } = newestMtime(dir);
    if (truncated || o.now - Math.max(newest, st.mtimeMs) < RUN_TMP_IDLE_MS) continue;
    old.push(dir);
  }
  if (!old.length) return [];
  const held = [...procOpenPaths(), ...o.procCwds()];
  return old
    .filter((dir) => {
      let real;
      try {
        real = resolve(realpathSync(dir));
      } catch {
        return false; // gone since the scan (or unreadable): nothing to remove, and one entry must not fail the plan
      }
      return !held.some((p) => within(real, p) || within(dir, p));
    })
    .map((path) => ({
      kind: 'tmp',
      path,
      reason: 'per-run temp dir idle over 6 h, no live process holds it',
    }));
}

/**
 * Playwright's transform cache (WP-1024): `<tmpdir>/playwright-transform-cache-<euid>`. Nothing else prunes it and it
 * grew to 1.7 GB. Only files not modified for 6 h go, one by one: a missing entry is just re-transformed, so a running
 * Playwright never loses anything it needs, and the dir itself stays.
 */
export function pwCacheOldFiles(dir, cutoff) {
  const out = [];
  const walk = (d) => {
    for (const name of listOf(d) ?? []) {
      const p = join(d, name);
      const st = statOf(p);
      if (!st) continue;
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && st.mtimeMs < cutoff) out.push({ p, kb: Math.ceil((st.blocks * 512) / 1024) });
    }
  };
  walk(dir);
  return out;
}

export function pwCacheCandidates(o) {
  const dir = join(o.tmp, `playwright-transform-cache-${process.geteuid?.() ?? 0}`);
  const cutoff = o.now - RUN_TMP_IDLE_MS;
  const files = pwCacheOldFiles(dir, cutoff);
  if (!files.length) return [];
  const kb = files.reduce((n, f) => n + f.kb, 0);
  const reason = `${files.length} Playwright transform-cache files not modified for 6 h (re-transformed on demand)`;
  return [{ kind: 'pwcache', path: dir, cutoff, kb, reason }];
}

/** Removes the old files again at apply time (the scan may be minutes old); returns the count. */
export function prunePwCache(c) {
  let n = 0;
  for (const f of pwCacheOldFiles(c.path, c.cutoff)) {
    rmSync(f.p, { force: true });
    n++;
  }
  return n;
}
