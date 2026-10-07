import type { Migration } from '../db/migrate';

/**
 * Guest self-join links (WP-639, B-016): which role of which project a public `/join/<slug>` link admits, and whether
 * the switch is on. It lives in the control database, not in the config file: the switch applies immediately (owner
 * Q14) and a slug is unique across the instance, so one lookup resolves a link to its project. Only the creation
 * quota is a rule of the project and sits in the config (`roles.<role>.quota`).
 */
export const JOIN_LINKS_MIGRATION: Migration = {
  id: 6,
  name: 'join_links',
  sql: `
CREATE TABLE join_links (
  project_id TEXT NOT NULL, role TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)), updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, role));
`,
};
