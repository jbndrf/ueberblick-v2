// Layout of the backup folder (BACKUP_DIR). One place, so the backup service and the restore agree.
//   databases/<file>.db/   Litestream replica of each database (the replica-URL seam: only `replicaBase` knows it is a folder)
//   files/                 mirror of <data>/blobs (content-addressed, immutable)
//   journal/journal.json   erasure journal, replayed by a restore
import { join, resolve } from 'node:path';

/** Name of the blob folder inside the data directory (`fileBlobStore` in packages/server). */
export const DATA_BLOBS = 'blobs';

export function folderLayout(backupDir) {
  const root = resolve(backupDir);
  const replicaDir = join(root, 'databases');
  return {
    root,
    replicaDir,
    replicaBase: `file://${replicaDir}`,
    filesDir: join(root, 'files'),
    journalDir: join(root, 'journal'),
    journalPath: join(root, 'journal', 'journal.json'),
  };
}
