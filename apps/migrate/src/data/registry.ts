/** Registries of the data conversion (R6): the v3 system fields, the batch phases and the kinds of problem. */
import { defineRegistry, type KeyOf } from '@ueberblick/core';

/** v3 projected these onto the instance (`project_to`); a log row names one instead of a field key. */
export const V3_SYSTEM_FIELDS = defineRegistry([
  { key: 'stage', description: 'The current stage of the instance.' },
  { key: 'status', description: 'The instance status (active, completed ...).' },
  { key: 'geometry', description: 'The position or shape of the instance.' },
] as const);
export type V3SystemField = KeyOf<typeof V3_SYSTEM_FIELDS>;

/** The order in which the batches of one conversion are produced. */
export const DATA_PHASES = defineRegistry([
  { key: 'tables', description: 'Creates the rows of the custom tables (lookup features).' },
  { key: 'create', description: 'Creates one feature per v3 instance: position, stage, status, creator.' },
  { key: 'history', description: 'One run per later v3 run, in v3 order: values, no references.' },
  { key: 'links', description: 'References between features, once every feature exists and has its id.' },
] as const);
export type DataPhase = KeyOf<typeof DATA_PHASES>;

/** What could not be carried over. Every problem names the v3 record it belongs to. */
export const DATA_PROBLEMS = defineRegistry([
  {
    key: 'unknown_workflow',
    description: 'The instance names a workflow the converted project does not have.',
  },
  { key: 'unknown_table', description: 'The row names a custom table the converted project does not have.' },
  { key: 'unknown_field', description: 'A log row names a field the converted project does not have.' },
  { key: 'unknown_stage', description: 'The stage has no counterpart in the converted project.' },
  {
    key: 'no_counterpart',
    description: 'A value has no v4 counterpart (an option that is not in the project).',
  },
  { key: 'no_geometry', description: 'The instance has no usable geometry; v4 features need one.' },
  { key: 'bad_time', description: 'A timestamp cannot be read; the run has no phenomenon time.' },
  { key: 'unresolved_reference', description: 'A reference points at a record that was not converted.' },
  { key: 'reference_dropped', description: 'A single reference held several records; v4 keeps the first.' },
  {
    key: 'not_carried',
    description: 'Data v4 does not hold: files (no bytes in the export) and v3 centroids.',
  },
  { key: 'refused', description: 'The store refused the run.' },
  {
    key: 'unknown_role',
    description: 'A v3 user has a role the converted project does not have; the roster omits it.',
  },
] as const);
export type DataProblemCode = KeyOf<typeof DATA_PROBLEMS>;
