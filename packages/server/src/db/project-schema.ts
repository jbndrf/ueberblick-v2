import {
  ACTOR_KINDS,
  CONFIG_VERSION_STATUSES,
  IMPORT_JOB_STATES,
  PACK_BUILD_STATES,
  RUN_OUTCOMES,
} from '@ueberblick/core';
import type { Migration } from './migrate';
import { BUILDER_DRAFT_MIGRATION } from './migrations/builder-draft';
import { OBSERVATION_RESULT_TIME_MIGRATION } from './migrations/observation-result-time';
import { CANVAS_LAYOUT_MIGRATION } from './migrations/canvas-layout';
import { PREFS_MIGRATION } from '../prefs/migration';
import { CHAT_MIGRATION } from '../modules/chat/migration';
import { BLOB_UPLOADS_MIGRATION } from '../store/blobs/migration';
import { inList } from './sql';

/** project-<key>.db (docs/04). CHECK lists come from the core registries. */
export const PROJECT_MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
CREATE TABLE config_versions (
  version INTEGER PRIMARY KEY, schema TEXT NOT NULL,
  template TEXT, template_version TEXT,
  overlay TEXT NOT NULL,
  compiled TEXT NOT NULL, hash TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ${inList(CONFIG_VERSION_STATUSES)}),
  created_by TEXT, created_at TEXT NOT NULL);

CREATE TABLE participants (id TEXT PRIMARY KEY, name TEXT, roles TEXT NOT NULL, attrs TEXT, disabled_at TEXT);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ${inList(ACTOR_KINDS)}),
  task TEXT NOT NULL, config_version INTEGER NOT NULL,
  input TEXT NOT NULL, client_time TEXT, received_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ${inList(RUN_OUTCOMES)}), refusal_code TEXT,
  caused_by TEXT REFERENCES runs(id),
  seq INTEGER UNIQUE);

CREATE TABLE observations (
  seq INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  feature_id TEXT NOT NULL,
  property TEXT NOT NULL,
  result TEXT,
  phenomenon_time TEXT);
CREATE INDEX observations_by_feature ON observations (feature_id, property, seq);

CREATE TABLE features (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, config_version INTEGER NOT NULL,
  properties TEXT NOT NULL,
  geometry TEXT, anchor_lon REAL, anchor_lat REAL, area_m2 REAL,
  updated_seq INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE VIRTUAL TABLE feature_bbox USING rtree (rid, minx, maxx, miny, maxy);

CREATE TABLE edges (
  from_id TEXT NOT NULL, relation TEXT NOT NULL, to_id TEXT NOT NULL,
  derived INTEGER NOT NULL, updated_seq INTEGER NOT NULL,
  PRIMARY KEY (from_id, relation, to_id));
CREATE INDEX edges_by_to ON edges (to_id, relation);

CREATE TABLE blobs   (sha256 TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE outbox  (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
                      attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT, done_at TEXT);
CREATE TABLE timers  (feature_id TEXT, rule TEXT, due_at TEXT NOT NULL, PRIMARY KEY (feature_id, rule));
CREATE TABLE tombstones (seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, id TEXT NOT NULL);
CREATE TABLE saved_views (id TEXT PRIMARY KEY, owner TEXT NOT NULL, view TEXT NOT NULL);
`,
  },
  BUILDER_DRAFT_MIGRATION,
  {
    // The ledger's stored result (WP-104): `{"seq":{"from","to"}}` for an accepted run, `{"refusal":{...}}` for a
    // rejected one, so a repeated run id returns the identical result, message included.
    id: 3,
    name: 'runs_result',
    sql: 'ALTER TABLE runs ADD COLUMN result TEXT;',
  },
  {
    // What the sync read path filters and orders by (WP-106): features and edges by `updated_seq`.
    id: 4,
    name: 'sync_indexes',
    sql: `
CREATE INDEX features_by_seq ON features (updated_seq);
CREATE INDEX edges_by_seq ON edges (updated_seq);
`,
  },
  {
    // `Timers.tick` selects the rows with `due_at <= now`; without this index every tick scans the whole table.
    id: 5,
    name: 'timers_by_due',
    sql: 'CREATE INDEX timers_by_due ON timers (due_at);',
  },
  {
    // Erasure (WP-534, B-005): the one documented exception to append-only. Every UPDATE or DELETE on `observations`
    // and every UPDATE of `runs.input` is refused unless `erasure_guard.open = 1`, which only `server/src/erasure`
    // sets inside a run transaction; even then the only change allowed is blanking a result or an input to JSON null.
    id: 6,
    name: 'erasure',
    sql: `
CREATE TABLE erasure_subjects (subject TEXT PRIMARY KEY, erased_at TEXT NOT NULL);
CREATE INDEX runs_by_actor ON runs (actor);

CREATE TABLE erasure_guard (id INTEGER PRIMARY KEY CHECK (id = 1), open INTEGER NOT NULL CHECK (open IN (0, 1)));
INSERT INTO erasure_guard (id, open) VALUES (1, 0);

CREATE TRIGGER observations_no_update BEFORE UPDATE ON observations
WHEN (SELECT open FROM erasure_guard WHERE id = 1) = 0
  OR NEW.result IS NOT 'null'
  OR NEW.seq IS NOT OLD.seq OR NEW.run_id IS NOT OLD.run_id OR NEW.feature_id IS NOT OLD.feature_id
  OR NEW.property IS NOT OLD.property OR NEW.phenomenon_time IS NOT OLD.phenomenon_time
BEGIN SELECT RAISE(ABORT, 'observations are append-only: only an erasure run may blank a result'); END;

CREATE TRIGGER observations_no_delete BEFORE DELETE ON observations
BEGIN SELECT RAISE(ABORT, 'observations are append-only: rows are never deleted'); END;

CREATE TRIGGER runs_input_no_update BEFORE UPDATE OF input ON runs
WHEN (SELECT open FROM erasure_guard WHERE id = 1) = 0 OR NEW.input IS NOT 'null'
BEGIN SELECT RAISE(ABORT, 'runs.input may only be blanked by an erasure run'); END;
`,
  },
  {
    // Who looked at personal data (WP-535 subject export): ids and times only, never values.
    id: 7,
    name: 'access_log',
    sql: `
CREATE TABLE access_log (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL);
CREATE INDEX access_log_by_subject ON access_log (subject, at);
`,
  },
  {
    // Which runs ARE erasure runs (WP-536): written by `createErasure.erase` in the same transaction as the redaction,
    // so a backup restore replays exactly these and never guesses from a run's input. One run may erase several subjects:
    // one row per (run, subject). Ids and times only.
    id: 8,
    name: 'erasure_runs',
    sql: `
CREATE TABLE erasure_runs (run_id TEXT NOT NULL, subject TEXT NOT NULL, erased_at TEXT NOT NULL, PRIMARY KEY (run_id, subject));
`,
  },
  {
    // `Facts.edgesTo` (WP-179): the reverse index now also holds `from_id` (the `ORDER BY`, so no temp sort) and `derived`,
    // so the edge side of the read is covering; the only other lookup is the live far-end join. Hubs have 100+ in-edges.
    id: 9,
    name: 'edges_by_to_covering',
    sql: `
DROP INDEX edges_by_to;
CREATE INDEX edges_by_to ON edges (to_id, relation, from_id, derived);
`,
  },
  {
    // `Facts.ofType` (WP-594): the participant's lists read every live feature of a type by `type` in `id` order;
    // without this index the statement scans the whole `features` table. Partial on `deleted = 0`, the statement's
    // own filter, so a tombstone never sits in the index.
    id: 10,
    name: 'features_by_type',
    sql: `
CREATE INDEX features_by_type ON features (type, id) WHERE deleted = 0;
`,
  },
  {
    // WP-305: `deleted` becomes the system lifecycle (A-028 item 2). A deleted row stays `deleted`; the partial index
    // `features_by_type` is rebuilt on the served states (`Facts.ofType` filter).
    id: 11,
    name: 'features_lifecycle',
    sql: `
DROP INDEX features_by_type;
ALTER TABLE features ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active';
UPDATE features SET lifecycle = 'deleted' WHERE deleted = 1;
ALTER TABLE features DROP COLUMN deleted;
CREATE INDEX features_by_type ON features (type, id) WHERE lifecycle IN ('active','completed');
`,
  },
  {
    // Value moves of a deploy (WP-307): one row per `{ to }` mapping, written in the deploy transaction. The executor
    // (`deploy/move-executor.ts`) walks the features of the row in id order and records `next_id` after every batch,
    // so a restart continues where the last committed batch stopped. (11 belongs to WP-305.)
    id: 12,
    name: 'deploy_moves',
    sql: `
CREATE TABLE deploy_moves (
  id INTEGER PRIMARY KEY, version INTEGER NOT NULL, path TEXT NOT NULL, payload TEXT NOT NULL,
  next_id TEXT NOT NULL DEFAULT '', done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)));
CREATE INDEX deploy_moves_open ON deploy_moves (id) WHERE done = 0;
`,
  },
  {
    // Who may download a blob (WP-604): one row per file value an accepted run wrote, written in the run transaction.
    // The primary key leads with `sha256`, so "who references this blob" is an index range; erasure deletes by
    // (feature_id, property).
    id: 13,
    name: 'blob_refs',
    sql: `
CREATE TABLE blob_refs (
  sha256 TEXT NOT NULL, feature_id TEXT NOT NULL, property TEXT NOT NULL, run_id TEXT NOT NULL,
  PRIMARY KEY (sha256, feature_id, property, run_id)) WITHOUT ROWID;
CREATE INDEX blob_refs_by_feature ON blob_refs (feature_id, property);
`,
  },
  PREFS_MIGRATION,
  {
    // The roster in v3's shape (WP-310): per-project column definitions for the Teilnehmende table (E-Mail and Telefon
    // are fixed keys of `participants.attrs`, the admin's own columns are listed here), the marker of a self-joined
    // guest, the creation time and `hidden` (a removed participant: disabled and out of the list; runs keep the actor).
    id: 15,
    name: 'roster_v3_shape',
    sql: `
CREATE TABLE participant_columns (
  key TEXT PRIMARY KEY, label TEXT NOT NULL, type TEXT NOT NULL, default_value TEXT,
  required INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL);
ALTER TABLE participants ADD COLUMN self_joined INTEGER NOT NULL DEFAULT 0;
ALTER TABLE participants ADD COLUMN created_at TEXT;
ALTER TABLE participants ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    // Audit metadata of a feature (WP-306, A-028 item 3): who created it and when, and when it last changed, as columns of
    // `features` (fold derives them, sync carries them, `self.$created_by` etc. read them in SQL). Existing rows are
    // back-filled: the creator is the actor of the run of the `$type` observation, the times are the `phenomenon_time`s
    // of that observation and of the newest observation that has one. The index serves "Nur eigene" (`visible_when:
    // self.$created_by == actor.id`). (14 is the personal preferences, 15 the roster.)
    id: 16,
    name: 'features_audit',
    sql: `
ALTER TABLE features ADD COLUMN created_by TEXT;
ALTER TABLE features ADD COLUMN created_at TEXT;
ALTER TABLE features ADD COLUMN changed_at TEXT;
UPDATE features SET
  created_by = (SELECT r.actor FROM observations o JOIN runs r ON r.id = o.run_id
                WHERE o.feature_id = features.id AND o.property = '$type' ORDER BY o.seq LIMIT 1),
  created_at = (SELECT o.phenomenon_time FROM observations o
                WHERE o.feature_id = features.id AND o.property = '$type' ORDER BY o.seq LIMIT 1),
  changed_at = (SELECT o.phenomenon_time FROM observations o
                WHERE o.feature_id = features.id AND o.phenomenon_time IS NOT NULL ORDER BY o.seq DESC LIMIT 1);
CREATE INDEX features_by_creator ON features (type, created_by);
`,
  },
  {
    // Guest self-join (WP-639). The roster's `self_joined` and `created_at` (migration 15) mark a guest and when they joined; the expiry timer reads them. The creation quota counts `features.created_by` (migration 16); `features_by_creator` leads with `type`, so the quota count (all types of one creator) gets its own index.
    id: 17,
    name: 'guests',
    sql: `
CREATE INDEX participants_guests ON participants (created_at) WHERE self_joined = 1 AND disabled_at IS NULL;
CREATE INDEX features_by_creator_any ON features (created_by) WHERE created_by IS NOT NULL;
`,
  },
  {
    // Version pinning (WP-315, A-029): `features.pinned_version` is the projection of the reserved key `$version`
    // (null = the feature floats on the deployed version). The partial index serves `self.$version == n` and the live
    // set of pinned versions; a floating feature is not in it. Back-fill: the newest `$version` observation per feature
    // (a null result is an unpin and leaves the column null).
    id: 18,
    name: 'features_pinned_version',
    sql: `
ALTER TABLE features ADD COLUMN pinned_version INTEGER;
UPDATE features SET pinned_version = (
  SELECT CAST(json_extract(o.result, '$') AS INTEGER) FROM observations o
  WHERE o.feature_id = features.id AND o.property = '$version' ORDER BY o.seq DESC LIMIT 1);
CREATE INDEX features_pinned ON features (pinned_version) WHERE pinned_version IS NOT NULL;
`,
  },
  {
    // Offline pack builds (WP-350, A-032): one row per (pack hash, layer); the file is `<blobs>/packs/<project>/<pack_hash>/<layer>.pmtiles`.
    // `tiles_done` is the position in the sorted tile list (the resume point), `bytes` the data written so far, then the file size.
    id: 19,
    name: 'pack_builds',
    sql: `
CREATE TABLE pack_builds (
  pack_hash TEXT NOT NULL, pack_key TEXT NOT NULL, layer TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ${inList(PACK_BUILD_STATES)}),
  tiles_done INTEGER NOT NULL DEFAULT 0, tiles_total INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0, sha256 TEXT, max_zoom INTEGER, tiles INTEGER,
  error TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (pack_hash, layer));
CREATE INDEX pack_builds_by_state ON pack_builds (state);
`,
  },
  {
    // Timers per version (WP-318, A-029): the version an `elapsed` row was scheduled under, which is its subject's
    // effective version (`coalesce(pinned_version, deployed)`). Back-fill: the deployed version (null before a first
    // deploy; a null row is rescheduled under its subject's version at its first tick).
    id: 20,
    name: 'timers_config_version',
    sql: `
ALTER TABLE timers ADD COLUMN config_version INTEGER;
UPDATE timers SET config_version = (SELECT version FROM config_versions WHERE status = 'deployed');
`,
  },
  {
    // The feature a run is about (WP-362, E-9): `runs.feature_id` is a projection like `features.pinned_version` (the run's
    // `featureId`, or for an accepted create run the feature it created; null for a refused create run). It makes a feature's
    // refused runs findable (they have no observations); the Aktivität history reads `runs_by_feature` and
    // `observations_by_feature_seq`. Back-fill: the feature of the run's first observation (an old row did not keep the run's own `featureId`; a refused one has none).
    id: 21,
    name: 'runs_feature',
    sql: `
ALTER TABLE runs ADD COLUMN feature_id TEXT;
UPDATE runs SET feature_id = (SELECT o.feature_id FROM observations o WHERE o.run_id = runs.id ORDER BY o.seq LIMIT 1)
  WHERE feature_id IS NULL;
CREATE INDEX runs_by_feature ON runs (feature_id) WHERE feature_id IS NOT NULL;
CREATE INDEX observations_by_feature_seq ON observations (feature_id, seq);
`,
  },
  {
    // Import jobs (WP-363): one row per import over HTTP. The file is not kept; `problems` is the capped JSON list,
    // `problem_count` the exact count. A `queued` or `running` row no live job owns is a restart: it reads as failed.
    id: 22,
    name: 'import_jobs',
    sql: `
CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK (state IN ${inList(IMPORT_JOB_STATES)}),
  mode TEXT NOT NULL, replace INTEGER NOT NULL DEFAULT 0, task TEXT NOT NULL,
  rows_total INTEGER NOT NULL DEFAULT 0, rows_done INTEGER NOT NULL DEFAULT 0, imported INTEGER NOT NULL DEFAULT 0,
  problems TEXT NOT NULL DEFAULT '[]', problem_count INTEGER NOT NULL DEFAULT 0, outcome TEXT, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
`,
  },
  CANVAS_LAYOUT_MIGRATION,
  CHAT_MIGRATION,
  BLOB_UPLOADS_MIGRATION,
  OBSERVATION_RESULT_TIME_MIGRATION,
];
