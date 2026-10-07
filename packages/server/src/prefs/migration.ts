import type { Migration } from '../db/migrate';

/**
 * Personal preferences (WP-612): one row per person per project database. `participant_id` is the actor id (a
 * participant or an admin account). `record_json` is the stamped store `{ "<key path>": { value, at } }` of
 * `@ueberblick/core` `PrefStore`; `updated` is the server time of the last write. Never part of runs, observations,
 * sync pages, exports or the rule context.
 */
export const PREFS_MIGRATION: Migration = {
  id: 14,
  name: 'prefs',
  sql: `
CREATE TABLE prefs (
  participant_id TEXT PRIMARY KEY, record_json TEXT NOT NULL, updated TEXT NOT NULL) WITHOUT ROWID;
`,
};
