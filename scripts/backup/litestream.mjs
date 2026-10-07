// Litestream binary handling: pinned version, lookup on PATH, restore wrapper.
import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

export const LITESTREAM_VERSION = '0.3.13';

/** sha256 of the release tarballs of the pinned version (used by the test fetch helper). */
export const LITESTREAM_SHA256 = {
  'linux-amd64': 'eb75a3de5cab03875cdae9f5f539e6aedadd66607003d9b1e7a9077948818ba0',
  'linux-arm64': '9585f5a508516bd66af2b2376bab4de256a5ef8e2b73ec760559e679628f2d59',
};

export function releaseUrl(platform) {
  return `https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-${platform}.tar.gz`;
}

export function installHint() {
  return [
    `Litestream ${LITESTREAM_VERSION} was not found on PATH.`,
    `Install the pinned version: download ${releaseUrl('linux-amd64')} (or the build for your platform from`,
    `https://github.com/benbjohnson/litestream/releases/tag/v${LITESTREAM_VERSION}), unpack it and put the`,
    '`litestream` binary on PATH. See docs/process/backup.md.',
  ].join('\n');
}

/** Absolute path of the `litestream` executable on `pathEnv`, or null. */
export function findLitestream(pathEnv = process.env.PATH ?? '') {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'litestream');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

/** Restores one replica into `outPath` (which must not exist). Returns { ok, message }. */
export function restoreReplica(binary, replicaUrl, outPath) {
  const r = spawnSync(binary, ['restore', '-o', outPath, replicaUrl], { encoding: 'utf8' });
  if (r.error) return { ok: false, message: r.error.message };
  if (r.status !== 0) return { ok: false, message: (r.stderr || r.stdout || `exit ${r.status}`).trim() };
  return { ok: true, message: '' };
}
