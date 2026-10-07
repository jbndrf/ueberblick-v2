# Backup and restore (operator runbook)

Every SQLite database of an instance (`control.db` and each `project-<key>.db`, see `docs/04-data-model.md`) is replicated continuously with **Litestream** (pinned: 0.3.13). A scripted drill restores the replica into a scratch directory and proves it complete and consistent. Backups are not trusted until the drill has passed.

A backup copies only the databases and `<data>/blobs`. `<data>/tiles-cache/` (the tile proxy's cache) is a rebuildable cache and is never backed up (`folder.spec.ts` pins it).

## Targets
| | Target | Basis |
|---|---|---|
| RPO | about 1 to 5 s of writes (sync interval 1 s plus storage latency) | `sync-interval: 1s` in the generated config |
| RTO | minutes for a typical instance (restore time is roughly the database size divided by download speed, plus WAL replay) | measure with the drill: it prints no timing yet, so time the command |
| Retention | 720 h (30 days) of generations and snapshots; needs-owner (legal sign-off on the maximum life of erased data in a backup) | `retention` in the generated config (`DEFAULT_RETENTION`) |
| Drill | monthly, and after every Litestream or schema upgrade | schedule it in the operator's cron |

## Local folder (compose profile `backup`, WP-943)
With `BACKUP_DIR` set in `.env`, `docker compose --profile backup up -d` starts the `backup` service (`ops/litestream/Dockerfile`: pinned Litestream plus `scripts/backup/run.mjs`, sharing the `/data` volume, running as the user `node`). Every 60 s (`BACKUP_INTERVAL_S`) it:
1. regenerates the Litestream config (`config.mjs`) from the `*.db` files in `/data`. **A new project database is picked up within a minute:** Litestream 0.3 cannot reload its config, so when the database list changed the service rewrites the config and restarts Litestream, which resumes from the WAL (no data is lost),
2. mirrors `/data/blobs` into `BACKUP_DIR/files` (`files.mjs`: copies missing or size-changed files, mirrors deletions so an erasure's deleted bytes do not live on; an empty or missing source never wipes the backup),
3. exports the erasure journal to `BACKUP_DIR/journal/journal.json` (so the journal cadence is one minute, inside the required cadence below).

Layout of the folder: `databases/<file>.db/` (replicas, URL `file://<BACKUP_DIR>/databases/<file>`; `layout.mjs` is the only place that knows it is a folder, so another replica type changes `replicaBase` only), `files/`, `journal/`. Retention is the usual 720 h. An empty `BACKUP_DIR` makes the service refuse to start.

**Restore** (server stopped): `docker compose --profile backup run --rm backup restore [--force]`. The image carries Litestream, the workspace sources and the production modules (`ops/litestream/Dockerfile`; entry `scripts/backup/backup-cmd.sh`: `run` is the default, `restore` the other command), mounts `/data` and `/backup` and runs as `node`. It restores every database found in the folder through `restoreWithReplay` (journal replay and integrity check as below) and copies the files into a staging folder `<data>/.restore-staging` first. Only when all of that passed, the old top-level entries of `/data` are moved to `<data>/.restore-old`, the staged entries are renamed into place, and `.restore-old` is deleted. A failure before the swap deletes the staging and changes nothing; a failure mid-swap is rolled back the same way (the restored data then stays in `.restore-staging`). It refuses a non-empty `/data`, a leftover `.restore-old` and a missing journal; `--force` replaces the old content and a leftover instead.
Developer alternative on the host (Litestream 0.3.13 on `PATH`, a checkout): `node --experimental-transform-types --import ./scripts/backup/register.mjs scripts/backup/restore.mjs <BACKUP_DIR> ./data [--force]`.

Idle overhead of the `backup` service (two project databases, nothing changing): about 0.3 % CPU and 57 MiB RAM.

## Setup (other targets, by hand)
1. Generate the config from the data directory. It scans for `control.db` and `project-*.db`, so a new project is included the next time you generate:
   `node scripts/backup/config.mjs /var/lib/ueberblick s3://bucket/prod > ops/litestream/litestream.yml`
   Regenerate and reload Litestream whenever a project is created (add it to the deploy or project-creation step).
2. Run `litestream replicate -config ops/litestream/litestream.yml` as a service. Storage credentials come from the environment (`LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`); they are never written to the config or the repository.

## The drill
```
npm run -s backup:manifest -- /var/lib/ueberblick > manifest.json     # on the live server, read-only
npm run backup:drill -- s3://bucket/prod --manifest manifest.json --allow-lag
```
For each database the drill restores into a fresh directory under the OS temp dir (never into the live data directory; it refuses a scratch directory inside the manifest's data dir), then:
1. `PRAGMA integrity_check` must return `ok`,
2. the migration state is checked **read-only** against the ids the server knows (unknown or pending migrations fail; nothing is applied),
3. `max(seq)` of the observation log and every table's row count are compared to the manifest. Without `--allow-lag` they must match exactly; with it the restored copy may be behind the manifest (writes after the manifest was taken) but never ahead.

Exit code 0 means passed, 1 failed (with the reason per database), 2 wrong usage. `--keep` keeps the restored files. Without `--manifest` a `file://` replica is listed by directory; other replica types need the manifest.

If the Litestream binary is not on `PATH` the drill fails and prints the download URL of the pinned version. Tests download the pinned build once into `~/.cache/ueberblick/` and verify its sha256.

## Erasure journal and restore with replay
A backup taken before an erasure still holds the erased values, and `erasure_subjects` lives inside each project database, so an old snapshot does not know about the erasure. The **erasure journal** closes this. It holds one entry per (original erasure run, subject), taken from the `erasure_runs` table that `createErasure.erase` fills in the erase transaction (project migration 8; never guessed from a run's input) (subject, actor, source run id, time and the feature id and property key pairs of the null observations that run appended), ids only, never values. The export refuses loudly if a `redaction` tombstone cannot be attributed to an erasure run.
1. Export it from the live data directory on a schedule and after every erasure, and store it **outside the replica** (different bucket or host): `npm run backup:journal -- /var/lib/ueberblick /safe/place/journal.json`. It is a read-only export.
2. Restore with the journal, with the server stopped and the target files absent:
   `npm run backup:restore -- s3://bucket/prod /var/lib/ueberblick --journal /safe/place/journal.json --databases control.db,project-baum.db`
   Each database is restored to `<file>.restoring`. Every project database then gets each journaled erasure run submitted again as an ordinary run (`Store.submit`), with the original run id, task and input, and the feature id it created, all from the journal (ids only, never values). The replay store is the server's `composeProjectStore` (the same limits, config cache and form api as the runtime; a replay passes its own ids). Of the runtime's hooks it runs the timers hook only, so the restored database holds the derived `timers` rows a run would leave (the same `(feature, rule)` upsert; no timers loop starts, so nothing fires during a replay, even a row that is long due: the server fires it after the start). It leaves out the doorbell (no listener exists during a restore), the deletion of blob bytes and the blob sweeper (the replay collects the orphaned blob ids, and the sweeper removes the bytes at the next server start), and the outbox hook (the runtime wires none yet). It runs under one admin actor `restore` (`replayActor` in `replay.mjs`), not the original actor, because a refused replay would resurrect erased data and the journal holds no roles (A-022, provisional). The replayed run keeps the ORIGINAL run id, which is the audit link (a run has no metadata field); the original actor id stays in the journal entry only. The journal keeps only those input fields whose value is a subject id, so free text in an erasure form never reaches it (a task that needs another required field cannot be replayed and fails the restore). The task's `when` must therefore allow admins; a refusal fails the restore, naming the journaled run. Journals exported before the `task`, `input` and `created` fields existed fail the restore loudly: export a new one from the live server. A run id already in the restored ledger is answered from it, so the replay is idempotent. Each subject's `erasure_subjects` row is set to its original erasure time. A task that no longer exists in the restored config version fails the restore too, naming the run. After `PRAGMA integrity_check` passes for all databases they are renamed to their real names: all or none unless the process is killed mid-rename (renames are not atomic across files). A journaled erasure without a subject, task or input fails the restore.
3. **The marker:** until the replay ran, a restored database exists only as `*.restoring`, so the server cannot open it under its real name. On failure the staging files are removed and nothing is published. **Killed mid-rename:** some databases carry their real name and others still end in `.restoring`. This state is safe against resurrection, since every published file was replayed first. Recover by finishing the renames of the remaining `*.restoring` files, or delete everything and re-run the restore. The server refuses to boot while `*.restoring` files sit in the data dir (error names the files; it creates nothing), so a half-finished restore can never start as an empty project. The command refuses to overwrite an existing database and refuses to run without a journal.
4. Start the server. Pending migrations apply as usual, and the blob sweeper deletes the bytes of the blobs the replay orphaned (from the `blob` tombstones). Blob bytes are not part of the Litestream replica; back them up separately and restore them before starting.

Plain `litestream restore` (without the replay) resurrects erased values from a pre-erasure snapshot. Use it only for the drill, which reads and never publishes.

## Out of scope
Off-site storage credentials (needs-owner). Erasure mechanics: WP-534, `docs/decisions/later/B-005-gdpr-erasure-redaction-first.md`.

## Performance note
Litestream reads the WAL out of band and does not sit in the run transaction. The p95 with and without it still has to be measured on the server run bench (WP-104), which does not exist yet: follow-up.

## Erased data and restores
A backup taken before an erasure keeps the erased values until it expires, so retention is capped (default 30 days, needs-owner and legal sign-off) and every restore replays the erasure journal (above). **Residual risk:** an erasure newer than the last journal export is NOT replayed and would come back after a restore. Required cadence: export the journal after every erasure, and additionally at least hourly by cron.
