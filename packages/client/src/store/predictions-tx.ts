/** Small single-store transactions of the device store, kept out of `store.ts` (R8): predictions and the eviction flag. */
import type { RunId } from '@ueberblick/core/model';
import { runTx } from './idb';
import type { IdbDatabase } from './idb-types';
import type { Prediction } from './contract';
import { META_KEYS, STORES } from './schema';

export function putPredictionTx(db: IdbDatabase, prediction: Prediction): Promise<void> {
  return runTx(db, [STORES.predictions], 'readwrite', (tx) => {
    tx.objectStore(STORES.predictions).put(prediction);
  });
}

export function dropPredictionTx(db: IdbDatabase, runId: RunId): Promise<void> {
  return runTx(db, [STORES.predictions], 'readwrite', (tx) => {
    tx.objectStore(STORES.predictions).delete(runId);
  });
}

export function clearEvictedTx(db: IdbDatabase): Promise<void> {
  return runTx(db, [STORES.meta], 'readwrite', (tx) => {
    tx.objectStore(STORES.meta).delete(META_KEYS.evicted);
  });
}
