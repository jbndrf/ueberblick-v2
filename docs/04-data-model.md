# 04 · Data model

**SQLite with a fixed platform schema.** Changing a project never changes a table. The only DDL driven by config is expression indexes on properties marked `index: true`, which are created and dropped on deploy. Every deploy goes through `deployProject`, which also rebuilds the timers (`timers` table) of the new config and, when the running config changed, queues the offline pack builds (`pack_builds`, migration 19).

## control.db
```sql
CREATE TABLE projects    (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE accounts    (id TEXT PRIMARY KEY, email TEXT UNIQUE, oidc_sub TEXT UNIQUE, password_hash TEXT, mfa TEXT);
CREATE TABLE memberships (account_id TEXT, project_id TEXT, role TEXT NOT NULL, PRIMARY KEY (account_id, project_id));
CREATE TABLE credentials (                     -- participant tokens: stored readable, unique, reusable until revoked or expired
  token TEXT PRIMARY KEY, project_id TEXT NOT NULL, participant_id TEXT NOT NULL,
  expires_at TEXT, revoked_at TEXT, last_used_at TEXT);
CREATE TABLE sessions    (id_hash TEXT PRIMARY KEY, subject TEXT NOT NULL, project_id TEXT, device TEXT, expires_at TEXT NOT NULL);
CREATE TABLE templates (                       -- published, immutable
  key TEXT NOT NULL, version TEXT NOT NULL, source TEXT NOT NULL, compiled TEXT NOT NULL, published_at TEXT NOT NULL,
  PRIMARY KEY (key, version));
-- control migration 5 (WP-638): the instance's consent gate and legal pages; they belong to no project
CREATE TABLE instance_settings (id INTEGER PRIMARY KEY CHECK (id = 1),   -- one row, seeded
  require_consent INTEGER NOT NULL DEFAULT 0,
  consent_title TEXT NOT NULL DEFAULT '', consent_body TEXT NOT NULL DEFAULT '',
  accept_label TEXT NOT NULL DEFAULT '', reject_label TEXT NOT NULL DEFAULT '');
CREATE TABLE legal_pages (slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0, show_in_consent_footer INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
CREATE TABLE join_links (                      -- guest self-join links: which role of which project a public `/join/<slug>` admits (WP-639)
  project_id TEXT NOT NULL, role TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)), updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, role));
```

## project-&lt;key&gt;.db
```sql
CREATE TABLE config_versions (
  version INTEGER PRIMARY KEY, schema TEXT NOT NULL,
  template TEXT, template_version TEXT,        -- base
  overlay TEXT NOT NULL,                       -- the customer's changes (survive upgrades)
  compiled TEXT NOT NULL, hash TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','deployed','retired')),
  created_by TEXT, created_at TEXT NOT NULL);

CREATE TABLE participants (id TEXT PRIMARY KEY, name TEXT, roles TEXT NOT NULL, attrs TEXT, disabled_at TEXT,
  self_joined INTEGER NOT NULL DEFAULT 0, created_at TEXT, hidden INTEGER NOT NULL DEFAULT 0);  -- last three: migration 15 (WP-310)
CREATE TABLE participant_columns (             -- migration 15: the admin's own columns of the Teilnehmende table
  key TEXT PRIMARY KEY, label TEXT NOT NULL, type TEXT NOT NULL, default_value TEXT,
  required INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,                         -- UUIDv7 from the device = idempotency key
  actor TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('participant','admin','system','import')),
  task TEXT NOT NULL, config_version INTEGER NOT NULL,
  input TEXT NOT NULL, client_time TEXT, received_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted','rejected')), refusal_code TEXT,
  caused_by TEXT REFERENCES runs(id),          -- rule chains stay traceable
  seq INTEGER UNIQUE,                          -- last seq of the run's own observations; null for a rejected run
  result TEXT,                                   -- the ledger's stored result: {"seq":{"from","to"}} or {"refusal":{...}} (migration 3)
  feature_id TEXT);                              -- the feature the run is about (migration 21, WP-362, E-9): the run's featureId, for an accepted create the feature it created, null for a refused create run

CREATE TABLE observations (                    -- append-only: the truth (O&M)
  seq INTEGER PRIMARY KEY,                     -- global order = sync cursor
  run_id TEXT NOT NULL REFERENCES runs(id),    -- procedure (task) + observer (actor) via the run
  feature_id TEXT NOT NULL,                    -- featureOfInterest
  property TEXT NOT NULL,                      -- observedProperty (key)
  result TEXT,                                 -- JSON value
  phenomenon_time TEXT);                       -- resultTime = runs.received_at
CREATE INDEX observations_by_feature ON observations (feature_id, property, seq);
-- Migration 6 (erasure, B-005): triggers refuse every UPDATE and DELETE on observations and every UPDATE of
-- runs.input, unless erasure_guard.open = 1 (set only by server/src/erasure inside a run transaction) and the change
-- blanks a result or an input to JSON null. This is the ONE exception to append-only. The run transaction calls it
-- for every planned run with a non-empty PlannedRun.purge, i.e. a run of a task with a `redact` step (A-021, docs/09);
-- blob bytes are deleted after the commit. There is no other entry.
CREATE TABLE erasure_subjects (subject TEXT PRIMARY KEY, erased_at TEXT NOT NULL);  -- plain participant or feature ids
CREATE INDEX runs_by_actor ON runs (actor);
CREATE INDEX runs_by_feature ON runs (feature_id) WHERE feature_id IS NOT NULL;    -- migration 21 (WP-362): the feature's history incl. refused runs (they have no observations)
CREATE INDEX observations_by_feature_seq ON observations (feature_id, seq);         -- migration 21 (WP-362): the feature's history page
CREATE TABLE erasure_guard (id INTEGER PRIMARY KEY CHECK (id = 1), open INTEGER NOT NULL);  -- one row

CREATE TABLE features (                        -- derived: core.fold(observations)
  id TEXT PRIMARY KEY, type TEXT NOT NULL, config_version INTEGER NOT NULL,
  properties TEXT NOT NULL,                    -- current values, JSON
  geometry TEXT, anchor_lon REAL, anchor_lat REAL, area_m2 REAL,   -- geometry = the value of the type's declared primary geometry (empty when it has none)
  updated_seq INTEGER NOT NULL, lifecycle TEXT NOT NULL DEFAULT 'active',
  created_by TEXT, created_at TEXT, changed_at TEXT, pinned_version INTEGER);   -- audit metadata (A-028 item 3), derived by fold; index features_by_creator (type, created_by); pinned_version = migration 18 (WP-315, A-029), the $version projection
CREATE VIRTUAL TABLE feature_bbox USING rtree (rid, minx, maxx, miny, maxy);   -- rid = features.rowid

CREATE TABLE edges (
  from_id TEXT NOT NULL, relation TEXT NOT NULL, to_id TEXT NOT NULL,
  derived INTEGER NOT NULL, updated_seq INTEGER NOT NULL,
  PRIMARY KEY (from_id, relation, to_id));
CREATE INDEX edges_by_to ON edges (to_id, relation, from_id, derived);

CREATE TABLE blobs   (sha256 TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE outbox  (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
                      attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT, done_at TEXT);
CREATE TABLE timers  (feature_id TEXT, rule TEXT, due_at TEXT NOT NULL, config_version INTEGER, PRIMARY KEY (feature_id, rule));  -- config_version (migration 20, WP-318): the version the row was scheduled under = its subject's effective version coalesce(pinned_version, deployed)
CREATE TABLE tombstones (seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, id TEXT NOT NULL);
CREATE TABLE saved_views (id TEXT PRIMARY KEY, owner TEXT NOT NULL, view TEXT NOT NULL);

-- migration 2 (A-011): the builder's one working draft per project
CREATE TABLE builder_draft (
  id INTEGER PRIMARY KEY CHECK (id = 1),       -- one row; a later `name` column is additive (named drafts)
  template TEXT NOT NULL, template_version TEXT NOT NULL,   -- pinned base
  overlay TEXT NOT NULL,                       -- source text; may not compile while being edited
  revision INTEGER NOT NULL,                   -- starts at 1, +1 per accepted write (compare-and-swap)
  updated_by TEXT, updated_at TEXT NOT NULL);

-- migration 23 (WP-366, E-21): the canvas node positions of the Objektart canvas; an admin aid stored next to the draft,
-- never in the config, the overlay or a config version
CREATE TABLE canvas_layout (
  type TEXT NOT NULL, node_id TEXT NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL,
  updated_by TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (type, node_id));

-- migration 14 (WP-612): personal preferences, one row per person (participant or admin account id) per project
CREATE TABLE prefs (
  participant_id TEXT PRIMARY KEY,
  record_json TEXT NOT NULL,                   -- {"<key path>": {"value": <json>, "at": "<client time>"}}
  updated TEXT NOT NULL) WITHOUT ROWID;

-- migration 4 (WP-106): what the sync read path filters and orders by
CREATE INDEX features_by_seq ON features (updated_seq);
CREATE INDEX edges_by_seq ON edges (updated_seq);

-- migration 5: `Timers.tick` selects the rows with `due_at <= now`; without this index every tick scans the whole table
CREATE INDEX timers_by_due ON timers (due_at);

-- migration 7 (WP-535 subject export): who looked at personal data. Ids and times only, never values.
CREATE TABLE access_log (id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL);
CREATE INDEX access_log_by_subject ON access_log (subject, at);

-- migration 13 (WP-604): who may download a blob: one row per file value an accepted run wrote, written in the run transaction
CREATE TABLE blob_refs (
  sha256 TEXT NOT NULL, feature_id TEXT NOT NULL, property TEXT NOT NULL, run_id TEXT NOT NULL,
  PRIMARY KEY (sha256, feature_id, property, run_id)) WITHOUT ROWID;
CREATE INDEX blob_refs_by_feature ON blob_refs (feature_id, property);

-- migration 25 (WP-757): who uploaded the bytes of a blob; a participant run may only name a hash its actor uploaded (or already holds)
CREATE TABLE blob_uploads (
  sha256 TEXT NOT NULL, actor TEXT NOT NULL, actor_kind TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (sha256, actor, actor_kind)) WITHOUT ROWID;

-- migration 18 (WP-315, A-029): the version pin of the reserved key $version; a floating feature has no row in it
CREATE INDEX features_pinned ON features (pinned_version) WHERE pinned_version IS NOT NULL;
-- migration 19 (WP-350, A-032): the offline pack builds, one row per (pack hash, layer); the file is `<blobs>/packs/<project>/<pack_hash>/<layer>.pmtiles`
CREATE TABLE pack_builds (
  pack_hash TEXT NOT NULL, pack_key TEXT NOT NULL, layer TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','building','ready','failed')),
  tiles_done INTEGER NOT NULL DEFAULT 0, tiles_total INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0, sha256 TEXT, max_zoom INTEGER, tiles INTEGER,
  error TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (pack_hash, layer));
CREATE INDEX pack_builds_by_state ON pack_builds (state);

-- migration 22 (WP-363): import jobs over HTTP, one row per import; the file is not kept, `problems` the capped JSON list, `problem_count` the exact count
CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK (state IN ('queued','running','done','failed')),
  mode TEXT NOT NULL, replace INTEGER NOT NULL DEFAULT 0, task TEXT NOT NULL,
  rows_total INTEGER NOT NULL DEFAULT 0, rows_done INTEGER NOT NULL DEFAULT 0, imported INTEGER NOT NULL DEFAULT 0,
  problems TEXT NOT NULL DEFAULT '[]', problem_count INTEGER NOT NULL DEFAULT 0, outcome TEXT, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
```

Project migration 9 (`edges_by_to_covering`) widened this index so that `Facts.edgesTo` reads it as a covering search, already in `from_id` order, with no temporary sort.

**Roster (`participants`) and its writes (WP-168, WP-310, WP-639).** The roster is identity plus roles, not a feature, so it is not written by runs (R3 concerns features; `core.fold` does not read it). It is written directly, the way `memberships` is, by an admin in `packages/server/src/http/participants` and by the guest self-join in `packages/server/src/join` (WP-639): `addParticipant` (name required, id generated as a readable slug plus a random suffix, never typed), `updateParticipant`, `disableParticipant` / `enableParticipant` (`disabled_at`, reversible; tokens stay valid), `removeParticipant` (disabled plus `hidden = 1`, tokens revoked, sessions ended; the row stays because runs name the actor, and a missing row is refused with 401, A-025) and `listParticipants` / `listRoster({ guests })` (one query; hidden never listed, `self_joined` rows only with `guests: true`) and `joinAsGuest` (the guest self-join adds a `self_joined = 1` participant named `Gast` with the link's role through a public `/join/<slug>` link, a system write like an admin's; the guest expiry timer deactivates it 90 days after joining). `importParticipant` adds under a given id (v3 migration, seeds): name optional, role syntax only. `attrs` is one JSON object: `email` and `phone` are fixed keys, every other key is a column of `participant_columns` (migration 15: `key, label, type text|number|boolean|date, default_value, required, position`; `setColumns` / `listColumns`). A required column must have a value on add and update; a default applies on add. `setRoleMembers(ctx, role, { add, remove })` (WP-346, `members.ts`) is the Rollen page's "Teilnehmende bearbeiten" as one change set per role: all or nothing, an unknown role or person refuses it. A role in the config has a `label` and an optional `description` (`RoleSchema.description`, localized string, E-4). Roles are checked on add and update against the `roles` of the deployed config, of the draft overlay and (when the ctx carries a `TemplateSource`) of the draft's template; with neither a deployed config nor a draft any well-formed key passes. Changes apply at once and are not part of the draft (Q13). Roles are read on every request (`participantRolesOf`), so a change applies at once. `attrs` is part of the subject export, so E-Mail and Telefon are exported with the person. The migration fills the roster from the v3 users (ids and roles).

Admin API (an admin of the project, `authorizeAdmin`; every change also needs a same-origin browser request, `sec-fetch-site: same-origin`, else 403). Errors are `{ "error": "<code>", "message": { "en", "de" } }` with codes from `PARTICIPANT_ERRORS`.

| Method and path under `/api/admin/p/<project>/participants` | Body | Answer |
|---|---|---|
| `GET [?guests=true]` | | `{ participants: [{ id, name, email, phone, roles, attrs, selfJoined, createdAt, disabledAt, activeQrs }] }`; self-joined guests only with `guests=true`; `activeQrs` (unrevoked, unexpired logins) comes from one grouped query, `Auth.countActiveCredentials(projectId, at)`, not one call per participant |
| `POST` | `{ name, email?, phone?, roles?, attrs? }` | 201 `{ id }` (generated from the name), 409 `participant_exists` |
| `PATCH /<id>` | `{ name?, email?, phone?, roles?, attrs?, disabled? }` | 200, 404; `disabled` true or false switches the person off or on (reversible) |
| `DELETE /<id>` | | 200; disables and hides, revokes QR logins, ends sessions |
| `GET /columns` | | `{ columns: [{ key, label, type, default?, required? }] }` of the project's `participant_columns` |
| `PUT /columns` | `{ columns: [{ key, label, type, default?, required? }] }` | 200 `{ columns }`; replaces the definitions, the array order is the column order |
| `GET /<id>/credentials` | | `{ token, link, expiresAt, lastUsedAt }` of the current token; 404 `credential_none`. `link` is `/login?token=<urlencoded>` |
| `PUT /<id>/credentials` | `{ token?, expiresAt? }` | 200 same shape; sets the chosen token or generates one and revokes the earlier ones. 400 `token_too_short \| token_invalid \| invalid_expiry`, 409 `token_duplicate` (WP-607) |
| `POST /<id>/credentials` | `{ expiresAt? }` | 201 `{ token, expiresAt }`; no default expiry. Only for the old participants page, goes with it |
| `DELETE /<id>/credentials` | | 200; revokes the tokens and ends the sessions |

CLI: `npm run admin -- participant add|roles|list|disable|enable|remove|qr|revoke <project> ...` (see `--help` output of `npm run admin`).

## Semantics
- **A feature is created** by an observation of the reserved key `$type`, and its **lifecycle** is set by `$lifecycle` (registry `LIFECYCLE_STATES`: `active`, `completed`, `archived`, `deleted`; a feature starts `active`; written only by a run's `lifecycle` then step, A-028 item 2). `$created_by` is the third reserved key: plan writes it once on create, right after `$type`, with the id of the actor of the run (`creatorOf`, the one resolver of the creator). `$version` is the fourth (A-029, WP-311): the config version an Objekt is pinned to (see below). These are the only reserved keys, and none of them is ever a property. `archived` and `deleted` features are not served to devices and `plan` refuses a run on them (`case_closed`); a `completed` one is still served and accepts runs. `Facts` reads and the partial index `features_by_type` use `lifecycle IN ('active','completed')`; admin reads see all four states. Everything else, including geometry, is config-declared (F4).
- **Ids a run creates (WP-748).** The ids of the features and rule runs a plan creates are a pure function of the submitted run: `seededIds(run.id)` (`core/plan/seeded-ids.ts`; n-th feature id, n-th rule-run id, UUIDv7-shaped), minted inside `planFor` per submitted run, never from the caller's `ids` port and never from the clock. Device and server therefore store the same ids for the same run, in any batch and after any re-plan. Only a task with `on: $map` takes the id from the run (`run.featureId`, minted by the form). Timers and the admin tools still mint the id of their *own* run with the clock (`createServerIds`); the ids that run creates are seeded from it. Stored data and the sync protocol are unchanged: only the values of ids planned by new runs differ. **A create onto an existing id is refused (`id_taken`)**: `plan` checks every id a create claims (task, `$create`, `$seed`, rule-created feature, client-chosen `$map` `featureId`) against the facts and the batch, so no run overwrites a feature; the device predicts the same refusal from the same code. `planFor`'s `PlanPorts` has no `ids` port (only `fireRuleFor` takes `RulePorts` with one). **A rule run whose seeded id already exists in the ledger** is refused as `id_taken` too (WP-750): the store checks the planned rule runs against the ledger (one primary-key lookup each) after `planFor`, so core stays pure and the submitted run that caused it is the refused one; nothing but its ledger row is written. R13: no H1-H6 shape touched, only a registry code was added. **A replayed run id is bound to its actor and payload (WP-754):** the ledger answers a stored result only to the same actor with the same task, input and feature; any other submit under that id is `id_taken` without observations, and a submitted run whose id equals a rule run planned in the same batch is `id_taken` for every planned run, not only rule-caused ones.
- **Version pin (`$version`, A-029).** The reserved key `$version` holds an integer (`config_versions.version`) or `null`. Fold sets `FeatureState.pinnedVersion` from the newest observation (highest `seq`; null unpins; a value that is not a positive integer is ignored; absent means the feature floats on the deployed version). A create writes no pin. Only system and admin runs write it (the deploy and "auf aktuelle Version verschieben" steps, WP-314 and later): `plan` refuses any run input whose key starts with `$` as `not_permitted`, so a participant form can never carry it. It is never redacted (reserved keys are not redaction pairs), registered as system field `version` (`self.$version`, type `int`, column `pinned_version`), and carried by `MemoryStore` and the Facts conformance kit. `features.pinned_version INTEGER NULL` is its projection (project migration 18, WP-315): the fold writes it with the rest of the row, `Facts.feature` reads it as `pinnedVersion`, the partial index `features_pinned (pinned_version) WHERE pinned_version IS NOT NULL` holds only pinned features, and the migration back-fills the column from the newest `$version` observation of each feature (a null result stays null). `self.$version` therefore compiles to SQL (`f.pinned_version`; `SYSTEM_FIELDS.version.sql` is `true`) and is allowed in `visible_when`, derived relations and view and row filters; `self.$version == n` against a constant also states `f.pinned_version IS NOT NULL`, which lets SQLite search the partial index (`EXPLAIN QUERY PLAN`: `SEARCH f USING INDEX features_pinned (pinned_version=?)`). The effective version of a feature is `coalesce(pinned_version, deployed)`. The sync field arrives with WP-316 (sync per version). On a device, `FeatureState.version` (optional, core `model.ts`) is that effective version as the sync sent it (`SyncFeature.version`); absent for a feature the device made.
- **Audit metadata ("Erstellt von / am", "Zuletzt geändert").** **The times are the server receive time, as in v3 (WP-794, owner M8 = b, `docs/decisions/later/B-028-audit-times-read-result-time.md`).** Every observation carries the O&M `resultTime` (`observations.result_time`, optional `Observation.resultTime`), stamped in the one intake (`store/run/transaction.ts`, core `resultTimeOf` in `fold/audit.ts`): the time the server received the run (`runs.received_at`); an **import run** (actor kind `import`, so the v3 migration) keeps its historical `clientTime`, so migrated features keep their v3 created and updated times. `runs.received_at` stays the honest arrival time for everyone. `phenomenonTime` stays the work time (the device stamps it when the run is queued) and is still clamped for participants (WP-762): `clampClientTime` in `core/fold/audit.ts` keeps a participant's `clientTime` inside `[receivedAt - AUDIT_MAX_OFFLINE_AGE, receivedAt + AUDIT_CLOCK_SKEW]` (366 days and 5 minutes, `core/registry/limits.ts`); admin, import and system runs are not clamped; an unparseable time becomes `receivedAt`. Example: Mia fixes a defect offline on Monday and syncs on Thursday: the entry shows Thursday, the observation's `phenomenonTime` says Monday. A not yet synced run on the device has no `resultTime` yet and shows its device time, as v3 did before sync (`reference/src/lib/participant-state/gateway.svelte.ts:466-474, 505-508`); the synced row replaces it. In sync, `createdBy` follows `activity_names` like a run's actor: with it off the receiver gets the creator only of its own features. Fold derives three fields of `FeatureState` from the observations: `createdBy` (the first `$created_by` result), `createdAt` (the `resultTime`, else `phenomenonTime`, of the `$type` observation) and `changedAt` (that time of the newest observation that has one). A time is absent when neither exists; a rule or timer run is stamped like any other run, so a stage it writes has a time. Migration 16 back-filled the columns from `phenomenon_time`, migration 26 (`observations.result_time`) back-fills `result_time` from the run (`received_at`, or `client_time` for an import run) and recomputes `created_at` and `changed_at`. The fields are columns `created_by`, `created_at`, `changed_at` of `features`, they travel with the sync feature row (and the observation column `resultTime`, additive, null when absent), and the device holds them. `createdBy` is an actor id and is never redacted by erasure (erasure blanks property values, never reserved keys). Fold is incremental and device and server run the same fold, so they agree (property tests `fold/audit.spec.ts`, `fold/audit-result-time.spec.ts`, `store/run/fold-equivalence.spec.ts`). The time of one property's last change is not stored per feature: `changed_at('prop')` reads the newest observation of the property through the history port (A-038), so fold state does not grow (it reads `phenomenonTime`, the work time, not `resultTime`; B-028). The participant timeline shows a synced run at its receive time, so the creating run matches `createdAt`. Rules read them as `self.$created_by` etc. (docs/06). Outside the sync they appear as read-only OGC item properties `$created_by`, `$created_at`, `$changed_at` (H4, H6); the HTTP layer exposes them in a later work package.
- **The process start is an observation.** A run that creates a feature of a type with a `process` writes the observation `<process.property> = <process.start>` (docs/05); there is no column for the stage (R4).
- **Current value** = the observation with the highest `seq` for (feature, property). Only `fold` computes it.
- **Computed values are history.** A property with `computed` (docs/05) is written by plan in the same run as the change of its input (an observation like any other, so it is in the history, in sync and in the audit); `$recompute`, a reserved system task, brings one feature up to date after a deploy changed the expression.
- **Admin creation is history.** `$create` (WP-382, docs/03 "Admin creation and deletion"), the reserved system task of the Tabellen page's "Zeile hinzufügen", writes `$type`, `$created_by` and the given and default values in one run by the `admin` actor; `$lifecycle` by an admin deletes a row (the observation `$lifecycle`).
- **Admin corrections are history.** `$correct` (WP-370, docs/03 "Admin-Korrektur"), the reserved system task of the admin's Bearbeitungsmodus, writes ordinary observations of the properties an admin fixed, in one run per row; it never writes the process property or a `$` key.
- **History on the device** is capped at the last 10 observations per (feature, property). The server holds all of them.
- **Derived edges** are recomputed when the geometry of either side changes: R*Tree prefilter, then an exact predicate in `core.geo`.
- **Relation semantics: the far end exists and is not deleted.** A relation set, `Facts.edgesFrom`/`edgesTo` and `related` all return only edges whose far end (`to` for a read forwards, `from` for a read backwards) is a live feature: the inner JOIN with `lifecycle IN ('active','completed')` of the expr SQL translation. Edges to a never-created or deleted feature stay stored (the fold needs them and they return on restore) but are not visible through `Facts`. One conformance suite, `describeFactsConformance` in `@ueberblick/core/testing`, holds SQLite Facts and `MemoryStore` to this.
- **Files:** a `file` property stores a list of `{sha256, name, mime}` (at most `max_files`, default 10; `accept` lists MIME types such as `image/*` or extensions such as `.pdf`, absent means any), and the bytes live in `blobs`. The form check (`form/type.ts`) refuses a longer list, a type outside `accept` and a single object.
- **Everything is one transaction per run:** runs, observations, fold, edges, `blob_refs`, outbox, timers, seq. A **refused run** writes its `runs` row (`rejected`, with the refusal in `result`) and nothing else; a repeated run id returns `result` unchanged.
- **Edge tombstones:** removing an edge writes one `tombstones` row (`kind = edge`, `id` = the edge key `from NUL relation NUL to`) at a fresh seq above the batch's observations (`tombstones.seq` is the primary key, so one per seq). The server head is the highest seq of `observations` and `tombstones`.
- **The `geometry` column is a copy of the type's declared primary geometry** (`types.<t>.geometry`, compiled to `FoldType.primaryGeometry`; empty when the type declares none or the feature has no value there, with no fallback to another geometry property). Other geometry properties stay in `properties`; `feature_bbox` holds the union of the 2D bboxes of all geometry properties that have values (no row for an archived or deleted feature), so derived relations on any geometry property keep their prefilter. The anchor and the area come from the primary geometry (decision B-009).
- **Custom lookup tables** from v3 become feature types without geometry. Chat is a module with its own tables, outside core (B-020, `packages/server/src/modules/chat`; project migration 24): `messages(seq, id, tool, author, at, body, removed)` is a per-tool stream (`tool` = the tool key, `chat` first; `id` is the client UUID, `seq` the server order devices page by), `message_persons(seq, person_id)` and `message_features(seq, feature_id)` index the mentions the server extracted (known ids only; the body keeps unknown ones), and `chat_reads(person_id, tool, last_read_seq, last_mention_seq)` is the monotonic read state, compared by server seq and never by clock. Mentions are parsed by one function, `@ueberblick/core/mentions` (`@<person id>`, `#<feature id>`). Erasure and the subject export find messages by author, by mentioned person and by mentioned feature through the index tables. Erasure never deletes a row: the author's messages become `removed` rows (author and body empty, index rows dropped), a mention of an erased person or feature becomes `[removed]` in the body, and each changed message gets a new `seq` above the head, so `GET ?after=` re-delivers it and devices upsert by `id`. No `edited_at` or `deleted_at` yet (v3 had no edit or delete UI; a later migration entry adds them).

**Personal preferences (WP-612).** Not features, not runs: a participant's record of tools on/off, per-tool preferences, saved filters, theme, font size and language. It is never an observation, so it is not in feature history, sync pages, exports or the rule context (`actor` carries only id, kind and roles). Key paths (`packages/core/src/prefs`): `tools.<key>` (boolean), `tool_prefs.<tool>.<name>` (any JSON), `filters.saved`, `filters.active`, `filters.hidden` (`{ types, values }`, the Einfach switches; absent until the person switches something, so the project's start filter applies only then, WP-808), `ui.theme`, `ui.font_size`, `ui.locale`, `ui.map_layers` (`{ base, overlays }`, the Kartenlayer choice, WP-621), `ui.offline_images` (boolean, Offline-Bilder, WP-667), `ui.filter_tab` (a short tab key, e.g. `simple` or `views`, the filter sheet's remembered tab, WP-648); anything else is refused. Each key carries the client time of its last edit; `mergePrefs` keeps the later one per key (a tie goes to the larger canonical value), so merging is commutative and idempotent. Erasing a person deletes the row in the erasure's own transaction (`PrefsStore.remove`, called from `createErasure.erase`, `packages/server/src/erasure`); the admin reset endpoint does the same for one person.
