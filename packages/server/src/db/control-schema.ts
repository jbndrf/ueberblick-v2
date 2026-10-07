import type { Migration } from './migrate';
import { INSTANCE_SETTINGS_MIGRATION } from './migrations/instance-settings';
import { JOIN_LINKS_MIGRATION } from '../join/migration';
import { API_TOKENS_MIGRATION } from './migrations/api-tokens';
import { ADMIN_API_TOKENS_MIGRATION } from './migrations/admin-api-tokens';
import { PREVIEWS_MIGRATION } from './migrations/previews';
import { REUSABLE_CREDENTIALS_MIGRATION } from './migrations/reusable-credentials';

/** control.db (docs/04). */
export const CONTROL_MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
CREATE TABLE projects    (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE accounts    (id TEXT PRIMARY KEY, email TEXT UNIQUE, oidc_sub TEXT UNIQUE, password_hash TEXT, mfa TEXT);
CREATE TABLE memberships (account_id TEXT, project_id TEXT, role TEXT NOT NULL, PRIMARY KEY (account_id, project_id));
CREATE TABLE credentials (
  token_hash TEXT PRIMARY KEY, project_id TEXT NOT NULL, participant_id TEXT NOT NULL,
  expires_at TEXT, revoked_at TEXT, last_used_at TEXT);
CREATE TABLE sessions    (id_hash TEXT PRIMARY KEY, subject TEXT NOT NULL, project_id TEXT, device TEXT, expires_at TEXT NOT NULL);
CREATE TABLE templates (
  key TEXT NOT NULL, version TEXT NOT NULL, source TEXT NOT NULL, compiled TEXT NOT NULL, published_at TEXT NOT NULL,
  PRIMARY KEY (key, version));
`,
  },
  REUSABLE_CREDENTIALS_MIGRATION,
  {
    id: 3,
    name: 'project_description',
    sql: `ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT '';`,
  },
  PREVIEWS_MIGRATION,
  INSTANCE_SETTINGS_MIGRATION,
  JOIN_LINKS_MIGRATION,
  API_TOKENS_MIGRATION,
  ADMIN_API_TOKENS_MIGRATION,
  {
    // WP-1073: guest expiry asks "has this participant a live session" (the session slide is the last-activity mark).
    id: 9,
    name: 'sessions_by_subject',
    sql: 'CREATE INDEX sessions_by_subject ON sessions (subject, project_id, expires_at);',
  },
];
