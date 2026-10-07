// Filesystem reads for housekeep that tolerate an entry vanishing between listing and stat (WP-916).
// Other processes clean /tmp concurrently, so ENOENT (gone) and ENOTDIR (replaced mid-scan) mean
// "skip this entry". Every other error throws. `fsx` is the seam the specs replace to inject faults.
import { lstatSync, readdirSync } from 'node:fs';

export const fsx = { lstat: lstatSync, readdir: readdirSync };

export const vanished = (e) => e?.code === 'ENOENT' || e?.code === 'ENOTDIR';

/** Runs `read`; returns undefined when the entry vanished, rethrows anything else. */
export function ifPresent(read) {
  try {
    return read();
  } catch (e) {
    if (vanished(e)) return undefined;
    throw e;
  }
}

export const statOf = (path) => ifPresent(() => fsx.lstat(path));
export const listOf = (path, opts) => ifPresent(() => fsx.readdir(path, opts));
