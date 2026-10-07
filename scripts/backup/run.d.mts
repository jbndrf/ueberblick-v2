export function refreshConfig(input: { dataDir: string; backupDir: string; configPath: string }): {
  changed: boolean;
  databases: string[];
};
export function backupRound(input: { dataDir: string; backupDir: string }): {
  files: { copied: number; removed: number };
  problems: string[];
};
