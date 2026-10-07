import type { ExpectedMigrations } from './expected.mjs';
export interface DbStats {
  maxSeq: number | null;
  tables: Record<string, number>;
}
export interface Manifest {
  version: number;
  dataDir: string;
  databases: Record<string, DbStats>;
}
export interface DbVerdict {
  file: string;
  ok: boolean;
  problems: string[];
  stats: DbStats | null;
}
export function buildManifest(dataDir: string): Manifest;
export function verifyDb(input: {
  file: string;
  path: string;
  migrations: readonly { id: number; name: string; sql: string }[];
  migrationState: ExpectedMigrations['migrationState'];
  manifestEntry?: DbStats;
  allowLag?: boolean;
}): DbVerdict;
export function isInside(path: string, dir: string): boolean;
export function listFileReplicaDbs(replicaDir: string): string[];
