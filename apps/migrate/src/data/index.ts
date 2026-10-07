/** Migration of v3 data (WP-301): instances, their history and relations become import runs. */
export { convertData, DEFAULT_BATCH_SIZE, type ConvertDataOptions } from './convert';
export { migrate, runMigration, type MigrateOptions, type MigrationResult } from './migrate';
export { migrationStore, type MigrationStore } from './store';
export type { ImportTarget, ImportTasks } from '../config';
export { fillRoster, type RosterResult } from './roster';
export { checkpoint, createIdMap, runIdFor } from './ids';
export { DataExportError, readDataExport, toInstant } from './read';
export { DATA_PHASES, DATA_PROBLEMS, V3_SYSTEM_FIELDS } from './registry';
export type { DataPhase, DataProblemCode, V3SystemField } from './registry';
export type {
  Checkpoint,
  DataProblem,
  IdMap,
  RunBatch,
  V3DataExport,
  V3InstanceRecord,
  V3LogRow,
  V3UserRecord,
  V3TableRecord,
} from './types';
