/** The snapshot head kept next to the store cursor (`SyncMeta` in the worker host: no localStorage there). */
import { requestResult, runTx } from './idb';
import type { IdbDatabase } from './idb-types';
import { META_KEYS, STORES } from './schema';

export async function readSyncHead(db: IdbDatabase): Promise<number | undefined> {
  const v = await requestResult(db.transaction(STORES.meta).objectStore(STORES.meta).get(META_KEYS.syncHead));
  return typeof v === 'number' ? v : undefined;
}

export async function readLastSynced(db: IdbDatabase): Promise<string | undefined> {
  const v = await requestResult(
    db.transaction(STORES.meta).objectStore(STORES.meta).get(META_KEYS.lastSynced),
  );
  return typeof v === 'string' ? v : undefined;
}

/** When the last pull completed (WP-678); `undefined` forgets it. */
export function writeLastSynced(db: IdbDatabase, at: string | undefined): Promise<void> {
  return runTx(db, [STORES.meta], 'readwrite', (tx) => {
    const meta = tx.objectStore(STORES.meta);
    if (at === undefined) meta.delete(META_KEYS.lastSynced);
    else meta.put(at, META_KEYS.lastSynced);
  });
}

/** `undefined` clears the head. */
export function writeSyncHead(db: IdbDatabase, head: number | undefined): Promise<void> {
  return runTx(db, [STORES.meta], 'readwrite', (tx) => {
    const meta = tx.objectStore(STORES.meta);
    if (head === undefined) meta.delete(META_KEYS.syncHead);
    else meta.put(head, META_KEYS.syncHead);
  });
}
