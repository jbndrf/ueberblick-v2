import type { Migration } from '../../db/migrate';

/**
 * The per-tool message stream (B-020, WP-682); the Projekt-Chat is its first user (`tool = 'chat'`). Not features and
 * not runs (R3 covers features and edges): chat data never changes a feature.
 *
 * - `messages.seq` is the server order the device pages by; `id` is the client's UUID (idempotent send). `author` is a
 *   participant id, `at` the server time. `body` is 1 to 4000 characters (`MENTION_BODY_MAX`, enforced by the route). `removed` marks an erased
 *   author's message: author and body are empty, the row stays so devices that mirrored it receive the removal.
 * - `message_persons` / `message_features` index the mentions the server extracted (known ids only), keyed by `seq`, so
 *   erasure and export find messages by mentioned person and by mentioned feature without a scan (as `runs.feature_id`
 *   did, WP-362). Rows go with their message (`ON DELETE CASCADE`); a seq that moves (erasure re-delivers a changed message under a new seq) moves its index rows (`ON UPDATE CASCADE`).
 * - `chat_reads` is the read state of one person per tool, compared by server seq and never by clock; both marks only
 *   grow. Edit and delete columns (`edited_at`, `deleted_at`) are left out on purpose (a later migration adds them).
 */
export const CHAT_MIGRATION: Migration = {
  id: 24,
  name: 'chat_messages',
  sql: `
CREATE TABLE messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  tool TEXT NOT NULL,
  author TEXT NOT NULL,
  at TEXT NOT NULL,
  body TEXT NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1)));
CREATE INDEX messages_by_tool_seq ON messages (tool, seq);
CREATE INDEX messages_by_author ON messages (author);
CREATE TABLE message_persons (
  seq INTEGER NOT NULL REFERENCES messages (seq) ON UPDATE CASCADE ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  PRIMARY KEY (seq, person_id)) WITHOUT ROWID;
CREATE INDEX message_persons_by_person ON message_persons (person_id);
CREATE TABLE message_features (
  seq INTEGER NOT NULL REFERENCES messages (seq) ON UPDATE CASCADE ON DELETE CASCADE,
  feature_id TEXT NOT NULL,
  PRIMARY KEY (seq, feature_id)) WITHOUT ROWID;
CREATE INDEX message_features_by_feature ON message_features (feature_id);
CREATE TABLE chat_reads (
  person_id TEXT NOT NULL, tool TEXT NOT NULL,
  last_read_seq INTEGER NOT NULL DEFAULT 0, last_mention_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, tool)) WITHOUT ROWID;
`,
};
