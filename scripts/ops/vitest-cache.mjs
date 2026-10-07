// WP-993: vitest's fs module cache (WP-932) is on in every checkout, agent worktrees included. Measured on 138 specs:
// cache off 210 s, on and cold 198 s (no penalty), on and warm 127 s. It costs 200-400 MB per checkout, so it stays
// off when the disk is nearly full (below 8 GB free) and housekeep prunes idle worktree caches (WP-993).
import { createHash } from 'node:crypto';
import { readFileSync, statfsSync } from 'node:fs';
import { join } from 'node:path';

export const MIN_FREE_BYTES = 8 * 1024 ** 3;

/** Free bytes of the filesystem holding `path`. */
const freeBytesDefault = (path) => {
  const s = statfsSync(path);
  return s.bavail * s.bsize;
};

/** @param {string} root @param {Record<string, string | undefined>} [env] @param {(path: string) => number} [freeBytes] */
export function fsModuleCacheOn(root, env = process.env, freeBytes = freeBytesDefault) {
  const override = env.UEB_VITEST_FS_CACHE;
  if (override === '1') return true;
  if (override === '0') return false;
  try {
    return freeBytes(root) >= MIN_FREE_BYTES;
  } catch {
    return false;
  }
}

/** The 12-character sha1 of `<dir>/package-lock.json`: the name of the dir the module cache lives in (housekeep prunes the others). */
export function lockHash(dir) {
  try {
    return createHash('sha1')
      .update(readFileSync(join(dir, 'package-lock.json')))
      .digest('hex')
      .slice(0, 12);
  } catch {
    return null;
  }
}
