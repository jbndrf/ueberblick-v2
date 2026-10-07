export const DATA_BLOBS: string;
export function folderLayout(backupDir: string): {
  root: string;
  replicaDir: string;
  replicaBase: string;
  filesDir: string;
  journalDir: string;
  journalPath: string;
};
