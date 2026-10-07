/** Reading queued runs: from an open connection, or (for export) from a fresh read-only look. */
import { DeviceStoreError } from './codes';
import type { StoredRun } from './contract';
import { runTx } from './idb';
import type { IdbDatabase, IdbEnv } from './idb-types';
import { STORES } from './schema';
import { toStoredRun, type RunRow } from './runs';

export async function readRunsFrom(db: IdbDatabase): Promise<readonly StoredRun[]> {
  let rows: RunRow[] = [];
  await runTx(db, [STORES.runs], 'readonly', (tx, guard) => {
    const req = tx.objectStore(STORES.runs).getAll();
    req.onsuccess = guard(() => {
      rows = req.result as RunRow[];
    });
  });
  return rows.map(toStoredRun);
}

/**
 * Opens the database at its current version (no upgrade, no delete) just to read the queue.
 * A database that does not exist is not created and gives `open_failed`.
 */
export async function readRunsForExport(env: IdbEnv, name: string): Promise<readonly StoredRun[]> {
  let db: IdbDatabase;
  try {
    db = await openWithoutUpgrade(env, name);
  } catch (e) {
    throw new DeviceStoreError('open_failed', 'Runs cannot be read for export.', { cause: e });
  }
  try {
    if (!db.objectStoreNames.contains(STORES.runs)) return [];
    return await readRunsFrom(db);
  } finally {
    db.close();
  }
}

function openWithoutUpgrade(env: IdbEnv, name: string): Promise<IdbDatabase> {
  return new Promise((resolve, reject) => {
    const req = env.factory.open(name);
    req.onupgradeneeded = () => req.transaction?.abort(); // it did not exist: do not create it
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('open failed'));
  });
}
