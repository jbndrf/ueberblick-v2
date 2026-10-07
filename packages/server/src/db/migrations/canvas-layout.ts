import type { Migration } from '../migrate';

/**
 * Canvas node positions (WP-366, E-21): where the admin dragged a node on the builder canvas. An admin aid
 * stored next to the draft, never in the config, the overlay or a config version, so publishing, rollback and
 * template upgrade do not touch it. Keyed by (type, node_id); another canvas (H1, H5) adds a `scope` column.
 */
export const CANVAS_LAYOUT_MIGRATION: Migration = {
  id: 23,
  name: 'canvas_layout',
  sql: `
CREATE TABLE canvas_layout (
  type TEXT NOT NULL, node_id TEXT NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL,
  updated_by TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (type, node_id));
`,
};
