/**
 * The files of a deleted project (A-037): one removal function for the delete and for the startup sweep (R1).
 * Idempotent: a path that is not there is not an error.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../../db/driver';
import { assertProjectKey, projectDbPath } from '../../db/open';
import { previewBlobDir, previewDbPath } from '../../preview/registry';
import { packsDir } from '../packs/wiring';
import { tilesDir } from '../../tiles/upload/wiring';

/**
 * Removes everything a project key leaves on disk: the project database (+ wal, shm, journal), `blobs/<key>`, the
 * offline packs, `tiles-cache/<key>`, and the preview's database and blobs (both are named by the key, so they are
 * found after the control rows are gone). Throws on the first path that cannot be removed, and
 * before removing anything for a reserved key (`ReservedProjectKey`: its directories belong to every project).
 */
export function removeProjectFiles(dataDir: string, key: string): void {
  assertProjectKey(key);
  for (const base of [projectDbPath(dataDir, key), previewDbPath(dataDir, key)])
    for (const f of [base, `${base}-wal`, `${base}-shm`, `${base}-journal`]) rmSync(f, { force: true });
  for (const dir of [
    join(dataDir, 'blobs', key),
    previewBlobDir(dataDir, key),
    packsDir(dataDir, key),
    tilesDir(dataDir, key),
    join(dataDir, 'tiles-cache', key),
  ])
    rmSync(dir, { recursive: true, force: true });
}

export interface SweepDeps {
  readonly control: Db;
  readonly dataDir: string;
  /** A failure for one key: the sweep goes on with the next and never throws. */
  onError(key: string): void;
  /** Test seam; the default is `removeProjectFiles`. */
  readonly removeFiles?: (dataDir: string, key: string) => void;
}

/**
 * Finishes project deletes whose file removal failed: runs `removeProjectFiles` for every key in `retired_projects`
 * (O(retired keys)). Keys that are not retired are never touched (an unknown file may be an import in progress).
 * Returns how many keys it swept without error.
 */
export function sweepRetiredProjects(deps: SweepDeps): number {
  const remove = deps.removeFiles ?? removeProjectFiles;
  let ok = 0;
  let keys: string[] = [];
  try {
    keys = deps.control
      .prepare<{ key: string }>('SELECT key FROM retired_projects')
      .all()
      .map((r) => r.key);
  } catch {
    return 0;
  }
  for (const key of keys) {
    try {
      remove(deps.dataDir, key);
      ok += 1;
    } catch {
      deps.onError(key);
    }
  }
  return ok;
}
