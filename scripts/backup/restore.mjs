// Restore an instance from the backup folder into an EMPTY data directory: databases (Litestream replicas, with the
// erasure journal replayed, so erasures stay erased) and blob files. Run with the server stopped.
//   node --experimental-transform-types --import ./scripts/backup/register.mjs scripts/backup/restore.mjs <BACKUP_DIR> <data-dir>
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { syncTree } from './files.mjs';
import { DATA_BLOBS, folderLayout } from './layout.mjs';
import { restoreWithReplay } from './replay.mjs';
import { listFileReplicaDbs } from './verify.mjs';

/** Staging folder inside the data dir (same volume, so the final swap is renames). */
const STAGING = '.restore-staging';
/** Where the old content goes during the swap (same volume). It is only deleted after the restored content is in place. */
const OLD = '.restore-old';

/** Returns { ok, problems[], results[] }; `restore`, `rename` and `remove` (the final delete of the old data) are test seams (defaults: Litestream and fs). */
export function restoreFromFolder({
  backupDir,
  dataDir,
  restore,
  pathEnv,
  force = false,
  rename = renameSync,
  remove = rmSync,
}) {
  const layout = folderLayout(backupDir);
  const fail = (...problems) => ({ ok: false, problems, results: [] });
  const staging = join(dataDir, STAGING);
  const oldDir = join(dataDir, OLD);
  const oldEntries = () =>
    existsSync(dataDir) ? readdirSync(dataDir).filter((f) => f !== STAGING && f !== OLD) : [];
  if (oldEntries().length > 0 && !force)
    return fail(
      `${dataDir} is not empty: restore only into an empty data folder (or pass --force to replace it)`,
    );
  // A .restore-old folder from a crashed restore holds the old data: nothing may delete it without looking at it.
  if (existsSync(oldDir) && !force)
    return fail(
      `${oldDir} holds old data (left by a restore that failed mid-swap, or one that succeeded but could not delete it): inspect it, then remove the folder (or pass --force to replace it)`,
    );
  const databases = listFileReplicaDbs(layout.replicaDir);
  if (databases.length === 0) return fail(`no database backups found in ${layout.replicaDir}`);
  if (!existsSync(layout.journalPath))
    return fail(`no erasure journal at ${layout.journalPath}: the backup service has not completed a round`);
  const journal = JSON.parse(readFileSync(layout.journalPath, 'utf8'));
  // Everything is restored, replayed, checked and filled with files in a staging folder on the same volume first.
  // The old content is only touched after all of that passed: the swap moves the old content into .restore-old,
  // then the restored content into place, and only then deletes the old content. A failure before the swap deletes
  // the staging and changes nothing; a failure mid-swap is rolled back (old data put back, restored data kept in staging).
  rmSync(staging, { recursive: true, force: true });
  let swapping = false;
  let outDone = false;
  let r;
  try {
    if (force) rmSync(oldDir, { recursive: true, force: true }); // leftovers are part of the content being replaced
    r = restoreWithReplay({
      replica: layout.replicaBase,
      dataDir: staging,
      databases,
      journal,
      restore,
      pathEnv,
      clock: { now: () => new Date().toISOString() },
    });
    if (!r.ok) {
      rmSync(staging, { recursive: true, force: true });
      return r;
    }
    // Litestream leaves its scratch WAL/SHM next to the restored files; nothing in them is needed
    for (const f of readdirSync(staging))
      if (/\.restoring\.tmp-(shm|wal)$/.test(f)) rmSync(join(staging, f), { force: true });
    syncTree(layout.filesDir, join(staging, DATA_BLOBS));
    // swap: same-volume renames, one entry at a time, so no entry can be lost
    swapping = true;
    mkdirSync(oldDir, { recursive: true });
    for (const f of oldEntries()) rename(join(dataDir, f), join(oldDir, f));
    outDone = true;
    for (const f of readdirSync(staging)) rename(join(staging, f), join(dataDir, f));
    // the restored data is in place: from here on the restore has succeeded and there is nothing to roll back
    swapping = false;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!swapping) {
      rmSync(staging, { recursive: true, force: true });
      return fail(`restore failed before the swap: ${msg} (the data folder was not changed)`);
    }
    // Roll back the half-swapped state: every entry moves to the side it came from. An entry is in exactly one
    // of the three places at a time, so no rename can collide.
    let back = true;
    try {
      if (outDone)
        for (const f of readdirSync(dataDir))
          if (f !== STAGING && f !== OLD) rename(join(dataDir, f), join(staging, f));
      for (const f of readdirSync(oldDir)) rename(join(oldDir, f), join(dataDir, f));
    } catch {
      back = false;
    }
    if (back) {
      try {
        rmSync(oldDir, { recursive: true, force: true }); // empty now; a leftover would just refuse the next restore
      } catch {
        // the empty folder stays: it cannot hold data and the next restore will report it
      }
      return fail(
        `the swap of the restored data into place failed and was rolled back: ${msg} (the data folder was not changed, the restored data is in ${staging})`,
      );
    }
    return fail(
      `the swap of the restored data into place failed and the rollback failed too: ${msg}. Nothing was deleted: the old data is in ${dataDir} and/or ${oldDir}, the restored data is in ${staging}; inspect and move the folders by hand`,
    );
  }
  // Point of no return: the restore succeeded. The old data only existed to allow a rollback; deleting it is
  // clean-up, and a failure of it is a warning, never a rollback.
  const warnings = [];
  try {
    remove(oldDir, { recursive: true, force: true });
  } catch {
    warnings.push(
      `Restore succeeded; the old data in ${oldDir} could not be removed completely and can be deleted by hand.`,
    );
  }
  // The now-empty staging is scratch; remove it
  // best-effort — a leftover is cleared at the start of the next restore.
  try {
    rmSync(staging, { recursive: true, force: true });
  } catch {
    // an empty leftover staging folder is harmless: the next restore clears it first
  }
  return { ...r, warnings };
}

if (process.argv[1]?.endsWith('restore.mjs')) {
  const force = process.argv.includes('--force');
  const [backupDir, dataDir] = process.argv.slice(2).filter((a) => a !== '--force');
  if (!backupDir || !dataDir || backupDir.startsWith('-')) {
    console.error(
      'usage: node --experimental-transform-types --import ./scripts/backup/register.mjs scripts/backup/restore.mjs <BACKUP_DIR> <data-dir> [--force]',
    );
    process.exit(2);
  }
  const r = restoreFromFolder({ backupDir, dataDir, force });
  for (const x of r.results) console.log(`  ${x.file}: ${x.replayed} erased pair(s) replayed`);
  for (const p of r.problems) console.error(`  FAIL ${p}`);
  for (const w of r.warnings ?? []) console.error(`  WARNING ${w}`);
  console.log(
    r.ok ? 'RESTORE PASSED (databases and files)' : 'RESTORE FAILED (the data folder was not changed)',
  );
  process.exit(r.ok ? 0 : 1);
}
