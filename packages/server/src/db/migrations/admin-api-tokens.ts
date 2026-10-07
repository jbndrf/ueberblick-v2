import type { Migration } from '../migrate';

/**
 * WP-1070 (supersedes the "per participant only" part of A-037). An API token belongs to a participant OR to an admin
 * account (`account_id`); exactly one of the two is set. SQLite cannot drop NOT NULL, so the table is rebuilt.
 */
export const ADMIN_API_TOKENS_MIGRATION: Migration = {
  id: 8,
  name: 'admin_api_tokens',
  sql: `
CREATE TABLE api_tokens_new (
  id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, project_id TEXT NOT NULL, participant_id TEXT, account_id TEXT,
  label TEXT NOT NULL, last_four TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'full',
  created_at TEXT NOT NULL, expires_at TEXT, last_used_at TEXT, revoked_at TEXT,
  CHECK ((participant_id IS NULL) != (account_id IS NULL)));
INSERT INTO api_tokens_new (id, token_hash, project_id, participant_id, label, last_four, scope, created_at, expires_at, last_used_at, revoked_at)
  SELECT id, token_hash, project_id, participant_id, label, last_four, scope, created_at, expires_at, last_used_at, revoked_at FROM api_tokens;
DROP TABLE api_tokens;
ALTER TABLE api_tokens_new RENAME TO api_tokens;
CREATE INDEX api_tokens_by_project ON api_tokens (project_id, created_at);
`,
};
