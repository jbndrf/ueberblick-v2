import type { ExpectedMigrations } from './expected.mjs';
import type { DbVerdict, Manifest } from './verify.mjs';

export interface DrillReport {
  ok: boolean;
  fatal?: string;
  scratch: string | null;
  results: DbVerdict[];
}
export function runDrill(opts: {
  replica: string;
  manifest?: Manifest;
  allowLag?: boolean;
  expected: ExpectedMigrations;
  pathEnv?: string;
  scratchParent?: string;
  keep?: boolean;
}): DrillReport;
export function formatReport(report: DrillReport): string;
