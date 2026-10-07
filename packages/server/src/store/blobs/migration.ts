import type { Migration } from '../../db/migrate';

/**
 * Who uploaded a blob (WP-757): one row per (file, actor) that PUT the real bytes. A run may name a file hash only when
 * its actor uploaded it, may already read it, or it is already on the run's subject; two actors uploading identical
 * bytes are both uploaders. Part of the compiled project schema, never per-project DDL.
 */
export const BLOB_UPLOADS_MIGRATION: Migration = {
  id: 25,
  name: 'blob_uploads',
  sql: `
CREATE TABLE blob_uploads (
  sha256 TEXT NOT NULL, actor TEXT NOT NULL, actor_kind TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (sha256, actor, actor_kind)) WITHOUT ROWID;
`,
};
