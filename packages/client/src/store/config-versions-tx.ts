/** The compiled config versions kept for queued runs (WP-514): one row per version number. */
import type { CompiledConfigData } from '@ueberblick/core/hydrate';
import type { StoredConfigVersion } from './contract';
import { runTx } from './idb';
import type { IdbDatabase } from './idb-types';
import { STORES } from './schema';

export function putConfigVersionTx(
  db: IdbDatabase,
  version: number,
  data: CompiledConfigData,
): Promise<void> {
  return runTx(db, [STORES.configVersions], 'readwrite', (tx) => {
    tx.objectStore(STORES.configVersions).put({ version, data });
  });
}

export async function readConfigVersionsTx(db: IdbDatabase): Promise<readonly StoredConfigVersion[]> {
  let rows: StoredConfigVersion[] = [];
  await runTx(db, [STORES.configVersions], 'readonly', (tx, guard) => {
    const req = tx.objectStore(STORES.configVersions).getAll();
    req.onsuccess = guard(() => {
      rows = req.result as StoredConfigVersion[];
    });
  });
  return rows;
}

export function deleteConfigVersionTx(db: IdbDatabase, version: number): Promise<void> {
  return runTx(db, [STORES.configVersions], 'readwrite', (tx) => {
    tx.objectStore(STORES.configVersions).delete(version);
  });
}
