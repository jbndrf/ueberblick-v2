import type { Migration } from '../migrate';

/**
 * WP-340 (A-031): a project's preview is a second database, registered here and not in `projects`, so every surface
 * that lists projects (OGC, MCP, exports, erasure, admin lists, backup) stays blind to it. `key` is the served key
 * `<project key>__vorschau`; `generation` grows on every drop, so a re-created preview gets a fresh device store.
 */
export const PREVIEWS_MIGRATION: Migration = {
  id: 4,
  name: 'previews',
  sql: `
CREATE TABLE previews (
  project_id TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, key TEXT UNIQUE NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, last_good_version INTEGER, created_at TEXT NOT NULL);
`,
};
