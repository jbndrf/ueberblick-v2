import type { Migration } from '../migrate';

/**
 * WP-638 (G5): instance-level settings, one row for the whole instance (consent gate) plus the legal pages. They live
 * in control.db because they belong to no project. A later setting is a new column or table in a later migration.
 */
export const INSTANCE_SETTINGS_MIGRATION: Migration = {
  id: 5,
  name: 'instance_settings',
  sql: `
CREATE TABLE instance_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  require_consent INTEGER NOT NULL DEFAULT 0,
  consent_title TEXT NOT NULL DEFAULT '',
  consent_body TEXT NOT NULL DEFAULT '',
  accept_label TEXT NOT NULL DEFAULT '',
  reject_label TEXT NOT NULL DEFAULT '');
INSERT INTO instance_settings (id) VALUES (1);
CREATE TABLE legal_pages (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  show_in_consent_footer INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL);
`,
};
