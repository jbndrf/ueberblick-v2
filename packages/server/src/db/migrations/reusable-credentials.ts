import type { Migration } from '../migrate';

/**
 * WP-606 (C-002 supersedes A-006): a participant token is reusable and stored readable, like v3's login.
 * The old hashed one-time credentials cannot be turned back into tokens, so they are dropped (pre-release, R11).
 * `token` is the primary key: the token alone identifies participant and project, so it is unique in the instance.
 * Nothing in the table is tied to participants beyond `participant_id`, so another credential kind can reuse it later.
 */
export const REUSABLE_CREDENTIALS_MIGRATION: Migration = {
  id: 2,
  name: 'reusable_credentials',
  sql: `
DROP TABLE credentials;
CREATE TABLE credentials (
  token TEXT PRIMARY KEY, project_id TEXT NOT NULL, participant_id TEXT NOT NULL,
  expires_at TEXT, revoked_at TEXT, last_used_at TEXT);
CREATE INDEX credentials_by_participant ON credentials (project_id, participant_id);
`,
};
