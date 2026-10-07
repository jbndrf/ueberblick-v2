// Backup replay (B-005, WP-536): a restore from a snapshot older than an erasure must not resurrect erased values.
// The erasure journal (journal.mjs, kept outside the replica) says which (feature, property) pairs were redacted; the
// replay re-submits each original erasure run as an ordinary run (same id, task, actor and input) before the database is published under its real name. Until then it only exists as
// `<file>.restoring`, so the server cannot open a restored database that was not replayed.
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openSqlite } from '../../packages/server/src/db/driver.ts';
import { migrate } from '../../packages/server/src/db/migrate.ts';
import { PROJECT_MIGRATIONS } from '../../packages/server/src/db/project-schema.ts';
import { deployedVersion, loadConfig } from '../../packages/server/src/deploy/index.ts';
import { createLogger } from '../../packages/server/src/log/index.ts';
import { composeProjectStore } from '../../packages/server/src/http/shared/stores.ts';
import { findLitestream, installHint, restoreReplica } from './litestream.mjs';
import { replicaUrl } from './config.mjs';

/** A restored database lives under this suffix until its replay is done. */
export const STAGING_SUFFIX = '.restoring';

const NONE = { erasures: [] };

/**
 * The actor a replayed erasure runs under (A-022, provisional). Replay must not depend on the original actor's roles,
 * because a refused replay resurrects erased data, so it is one admin actor of the restore. The original actor id and run
 * id stay in the journal entry (the run input has no field for them). THE SEAM: option A swaps this for the original
 * actor with journaled roles.
 */
export function replayActor() {
  return { id: 'restore', kind: 'admin', roles: [] };
}

/**
 * Re-applies the journaled erasures of one project database file as ORDINARY runs (A-021, R3): one `submit` per original
 * erasure run, under its own task, input and run id, so a replay of the same journal answers from the ledger.
 * The task's `when` rule still applies, to the replay actor (`replayActor`): a refusal fails loudly and names the entry. So does a task that no longer exists in the config version, and an entry
 * without a subject. Returns { replayed (runs), orphanedBlobs } (blob bytes are removed at the next server start by the
 * blob sweeper, from the `blob` tombstones).
 */
export function replayProject(path, entry, { clock }) {
  const db = openSqlite(path);
  try {
    migrate(db, PROJECT_MIGRATIONS);
    const known = db.prepare('SELECT 1 AS x FROM runs WHERE id = ?');
    const put = db.prepare(
      'INSERT INTO erasure_subjects (subject, erased_at) VALUES (?, ?) ON CONFLICT (subject) DO UPDATE SET erased_at = excluded.erased_at',
    );
    const orphanedBlobs = [];
    let store;
    let created;
    let replayed = 0;
    const bySource = new Map();
    for (const e of entry.erasures) {
      if (typeof e.subject !== 'string' || e.subject === '')
        throw new Error(`journaled erasure ${e.sourceRun ?? '?'} has no subject: refusing to replay it`);
      bySource.set(e.sourceRun, [...(bySource.get(e.sourceRun) ?? []), e]);
    }
    for (const [sourceRun, entries] of bySource) {
      const first = entries[0];
      if (known.get(sourceRun) === undefined) {
        const version = deployedVersion(db)?.version;
        if (version === undefined) throw new Error('the restored database has no deployed config version');
        const config = loadConfig(db, version);
        const named = `journaled erasure ${sourceRun} (task ${first.task ?? '?'})`;
        if (typeof first.task !== 'string' || config?.file.tasks?.[first.task] === undefined)
          throw new Error(`${named}: the task does not exist in config version ${version}`);
        if (first.input === null || typeof first.input !== 'object')
          throw new Error(`${named}: the journal holds no input to replay`);
        store ??= composeProjectStore(db, {
          clock,
          // A restore prints its own report; the replayed runs' log lines go nowhere.
          log: createLogger({ sink: () => undefined, now: () => Date.now() }),
          ids: {
            runId: () => {
              throw new Error('replay mints no run ids');
            },
            featureId: () => {
              if (created === undefined) throw new Error('replay mints no feature ids');
              return created;
            },
          },
          // No blob store here: the bytes are removed by the sweeper at the next server start, from the tombstones.
          onOrphanedBlobs: (ids) => orphanedBlobs.push(...ids),
        });
        created = first.created ?? undefined;
        const result = store.submit({
          id: sourceRun,
          task: first.task,
          actor: replayActor(),
          configVersion: version,
          input: first.input,
        });
        if (result.outcome !== 'accepted')
          throw new Error(
            `${named} was refused on replay: ${result.refusal.code}: ${result.refusal.message}`,
          );
        replayed++;
      }
      for (const e of entries) put.run(e.subject, e.erasedAt);
    }
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return { replayed, orphanedBlobs };
  } finally {
    db.close();
  }
}

const sidecars = (path) => [path, `${path}-wal`, `${path}-shm`];

/**
 * Restores every database into `<dataDir>/<file>.restoring`, replays the journal on the project databases, checks
 * integrity, and only when ALL passed renames them to their real names. Nothing is published on any failure.
 * `restore(url, outPath)` defaults to Litestream. Returns { ok, problems[], results[] }.
 */
export function restoreWithReplay({ replica, dataDir, databases, journal, restore, clock, pathEnv }) {
  const fail = (...problems) => ({ ok: false, problems, results: [] });
  if (!journal || typeof journal !== 'object' || journal.projects === undefined)
    return fail(
      'an erasure journal is required (node scripts/backup/journal.mjs, stored outside the replica)',
    );
  let doRestore = restore;
  if (!doRestore) {
    const binary = findLitestream(pathEnv);
    if (!binary) return fail(installHint());
    doRestore = (url, out) => restoreReplica(binary, url, out);
  }
  const existing = databases.filter((f) => existsSync(join(dataDir, f)));
  if (existing.length > 0) return fail(`refusing to overwrite: ${existing.join(', ')} already exists`);
  mkdirSync(dataDir, { recursive: true });
  const staging = (f) => join(dataDir, f + STAGING_SUFFIX);
  const cleanup = () =>
    databases.forEach((f) => sidecars(staging(f)).forEach((p) => rmSync(p, { force: true })));
  const problems = [];
  const results = [];
  for (const file of databases) {
    const out = staging(file);
    const r = doRestore(replicaUrl(replica, file), out);
    if (!r.ok || !existsSync(out)) {
      problems.push(`${file}: restore failed: ${r.message || 'no file produced'}`);
      continue;
    }
    try {
      const replay =
        file === 'control.db'
          ? { replayed: 0, orphanedBlobs: [] }
          : replayProject(out, journal.projects[file] ?? NONE, { clock });
      const raw = openSqlite(out);
      const check = raw.prepare('PRAGMA integrity_check').all();
      raw.close();
      if (check.length !== 1 || Object.values(check[0])[0] !== 'ok')
        problems.push(`${file}: integrity_check failed`);
      results.push({ file, ...replay });
    } catch (e) {
      problems.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (problems.length > 0) {
    cleanup();
    return { ok: false, problems, results };
  }
  for (const file of databases) renameSync(staging(file), join(dataDir, file));
  return { ok: true, problems: [], results };
}

async function main(argv) {
  const { readFileSync } = await import('node:fs');
  const flag = (n) => argv[argv.indexOf(n) + 1];
  const [replica, dataDir] = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  const usage =
    'usage: node --experimental-transform-types --import ./scripts/backup/register.mjs scripts/backup/replay.mjs <replica-url> <data-dir> --journal journal.json --databases control.db,project-x.db';
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage);
    return 0;
  }
  if (!replica || !dataDir || argv.indexOf('--journal') < 0) {
    console.error(usage);
    return 2;
  }
  const databases = (flag('--databases') ?? '').split(',').filter(Boolean);
  if (databases.length === 0) {
    console.error('--databases <control.db,project-<key>.db,...> is required (the files to restore)');
    return 2;
  }
  const journal = JSON.parse(readFileSync(flag('--journal'), 'utf8'));
  const r = restoreWithReplay({
    replica,
    dataDir,
    databases,
    journal,
    clock: { now: () => new Date().toISOString() },
  });
  for (const x of r.results) console.log(`  ${x.file}: ${x.replayed} erased pair(s) replayed`);
  for (const p of r.problems) console.error(`  FAIL ${p}`);
  console.log(r.ok ? 'RESTORE PASSED (replayed, published)' : 'RESTORE FAILED (nothing published)');
  return r.ok ? 0 : 1;
}

if (process.argv[1]?.endsWith('replay.mjs')) process.exit(await main(process.argv.slice(2)));
