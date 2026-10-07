import type { Migration } from '../migrate';

/**
 * The builder's working draft (A-011): one row per project database, so the key is the database itself.
 * `id = 1` keeps the row unique; a later `name` column (branches) replaces the CHECK and is additive.
 * The overlay is stored as text because a draft in progress often does not compile.
 */
export const BUILDER_DRAFT_MIGRATION: Migration = {
  id: 2,
  name: 'builder_draft',
  sql: `
CREATE TABLE builder_draft (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  template TEXT NOT NULL, template_version TEXT NOT NULL,
  overlay TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_by TEXT, updated_at TEXT NOT NULL);
`,
};
