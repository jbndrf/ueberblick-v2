import { defineRegistry, type KeyOf } from './define';

/** States of an import job (WP-363). A restart turns a `queued` or `running` job into `failed`, never a job that runs forever. */
export const IMPORT_JOB_STATES = defineRegistry([
  { key: 'queued', description: 'Accepted; planning has not started.' },
  { key: 'running', description: 'The file is read and its rows are being submitted.' },
  {
    key: 'done',
    description: 'Finished; `problems` lists the rows left out or the reason the import was refused.',
  },
  { key: 'failed', description: 'Stopped by an error or a restart; `error` says why.' },
] as const);
export type ImportJobState = KeyOf<typeof IMPORT_JOB_STATES>;

/** Typed refusals of the import endpoints, each with its HTTP status (401, 403 and 404 come from admin auth). */
export const IMPORT_ERRORS = defineRegistry([
  {
    key: 'not_published',
    status: 409,
    description: 'The project has no deployed version yet; import needs one.',
  },
  {
    key: 'replace_needs_atomic',
    status: 422,
    description: '`replace` needs `mode: atomic`: it is all or nothing.',
  },
  { key: 'file_too_large', status: 413, description: 'The file is over `IMPORT_LIMITS.maxFileBytes`.' },
  { key: 'invalid_import', status: 400, description: 'The upload or the mapping is malformed.' },
  { key: 'unknown_job', status: 404, description: 'No such import job in this project.' },
] as const);
export type ImportErrorCode = KeyOf<typeof IMPORT_ERRORS>;

/** Numbers of the import endpoints. */
export const IMPORT_LIMITS = {
  /** Largest upload. */
  maxFileBytes: 100 * 1024 * 1024,
  /** Problems a plan or a job report keeps (the count is exact). */
  maxProblems: 200,
  /** Rows of the dry run's preview. */
  previewRows: 10,
} as const;

/** Numbers of the project-file upload on the Projekte page ("Aus Datei importieren", WP-383). */
export const PROJECT_FILE_LIMITS = {
  /** Largest project file (YAML or JSON text). */
  maxBytes: 1024 * 1024,
} as const;
