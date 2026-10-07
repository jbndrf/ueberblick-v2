export const DEFAULT_RETENTION: string;
export function discoverDatabases(dir: string): string[];
export function replicaUrl(base: string, dbFile: string): string;
export function renderConfig(input: {
  dataDir: string;
  replicaBase: string;
  databases: string[];
  syncInterval?: string;
  retention?: string;
}): string;
export function generateConfig(input: {
  dataDir: string;
  replicaBase: string;
  syncInterval?: string;
  retention?: string;
}): string;
