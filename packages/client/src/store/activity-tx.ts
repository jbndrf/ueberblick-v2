/** Reads of the Aktivität data from IndexedDB (WP-602). */
import type { FeatureId, RecordedObservation } from '@ueberblick/core/model';
import type { SyncRun } from '@ueberblick/core/sync';
import { runTx } from './idb';
import type { IdbDatabase, IdbEnv } from './idb-types';
import { STORES } from './schema';

/** The run rows stored under these ids; an id with no row is simply absent. */
export async function readRunMeta(db: IdbDatabase, ids: readonly string[]): Promise<SyncRun[]> {
  const found: SyncRun[] = [];
  if (ids.length === 0) return found;
  await runTx(db, [STORES.runMeta], 'readonly', (tx, guard) => {
    const store = tx.objectStore(STORES.runMeta);
    for (const id of ids) {
      const req = store.get(id);
      req.onsuccess = guard(() => {
        if (req.result !== undefined) found.push(req.result as SyncRun);
      });
    }
  });
  return found;
}

/** The stored history rows of these features (all properties, at most the cap per property). */
export async function readHistory(
  db: IdbDatabase,
  env: IdbEnv,
  ids: readonly FeatureId[],
): Promise<Map<FeatureId, RecordedObservation[]>> {
  const loaded = new Map<FeatureId, RecordedObservation[]>();
  await runTx(db, [STORES.history], 'readonly', (tx, guard) => {
    const store = tx.objectStore(STORES.history);
    for (const id of ids) {
      const req = store.getAll(env.keyRange.bound([id], [id, []]));
      req.onsuccess = guard(() => loaded.set(id, req.result as RecordedObservation[]));
    }
  });
  return loaded;
}
