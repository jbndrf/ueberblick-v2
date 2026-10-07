import type { Migration } from '../migrate';

/**
 * WP-388 (A-037). Two additions to control.db:
 * - `api_tokens`: the admin-created QGIS / GIS tokens of a participant. Many per participant, stored only as a hash
 *   (the secret is shown once), with label, last four characters, last use and expiry. `scope` is the seam for
 *   narrower tokens later (assistants, H4); today every token is `full` (Q18).
 * - `retired_projects`: the keys of deleted projects. A key is never handed out again, so no cache that is keyed by
 *   project key can ever serve a new project from the deleted one's closed database. The trigger is the hard guard
 *   behind `freeKey`.
 */
export const API_TOKENS_MIGRATION: Migration = {
  id: 7,
  name: 'api_tokens_and_retired_projects',
  sql: `
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, project_id TEXT NOT NULL, participant_id TEXT NOT NULL,
  label TEXT NOT NULL, last_four TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'full',
  created_at TEXT NOT NULL, expires_at TEXT, last_used_at TEXT, revoked_at TEXT);
CREATE INDEX api_tokens_by_project ON api_tokens (project_id, created_at);
CREATE TABLE retired_projects (key TEXT PRIMARY KEY, retired_at TEXT NOT NULL);
CREATE TRIGGER projects_not_retired BEFORE INSERT ON projects
WHEN EXISTS (SELECT 1 FROM retired_projects WHERE key = NEW.key)
BEGIN SELECT RAISE(ABORT, 'project key was retired'); END;
`,
};
