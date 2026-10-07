export function restoreFromFolder(input: {
  backupDir: string;
  dataDir: string;
  restore?: (url: string, out: string) => { ok: boolean; message: string };
  pathEnv?: string;
  rename?: (from: string, to: string) => void;
  remove?: (path: string, options: { recursive: boolean; force: boolean }) => void;
  force?: boolean;
}): { ok: boolean; problems: string[]; warnings?: string[]; results: { file: string; replayed: number; orphanedBlobs: string[] }[] };
