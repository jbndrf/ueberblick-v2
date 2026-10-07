/** Loading the in-memory mirror from IndexedDB (open, and a replica re-reading after it diverged). */
import type { Edge, FeatureState } from '@ueberblick/core/model';
import { runTx } from './idb';
import type { IdbDatabase } from './idb-types';
import type { SyncPerson } from '@ueberblick/core/sync';
import type { Prediction, StoredCursor } from './contract';
import { toStoredRun, type RunRow } from './runs';
import type { MemoryIndex } from './memory';
import { META_KEYS, STORES } from './schema';

interface EdgeRow extends Edge {
  readonly updatedSeq: number;
}

/** Loads features, edges, predictions, blob keys, names, the queued runs and the cursor once. Returns the persisted `evicted` flag. */
export async function hydrate(db: IdbDatabase, mem: MemoryIndex): Promise<boolean> {
  let evicted = false;
  await runTx(
    db,
    [
      STORES.features,
      STORES.edges,
      STORES.predictions,
      STORES.blobs,
      STORES.meta,
      STORES.people,
      STORES.runs,
    ],
    'readonly',
    (tx, guard) => {
      const features = tx.objectStore(STORES.features).getAll();
      features.onsuccess = guard(() => {
        for (const f of features.result as FeatureState[]) mem.putFeature(f);
      });
      const edges = tx.objectStore(STORES.edges).getAll();
      edges.onsuccess = guard(() => {
        for (const e of edges.result as EdgeRow[])
          mem.putEdge({ from: e.from, relation: e.relation, to: e.to, derived: e.derived }, e.updatedSeq);
      });
      const predictions = tx.objectStore(STORES.predictions).getAll();
      predictions.onsuccess = guard(() => {
        for (const p of predictions.result as Prediction[]) mem.setPrediction(p);
      });
      const people = tx.objectStore(STORES.people).getAll();
      people.onsuccess = guard(() => mem.activity.putPeople(people.result as SyncPerson[]));
      const queued = tx.objectStore(STORES.runs).getAll();
      queued.onsuccess = guard(() => {
        for (const r of queued.result as RunRow[]) mem.activity.setQueued(toStoredRun(r));
      });
      const blobs = tx.objectStore(STORES.blobs).getAllKeys();
      blobs.onsuccess = guard(() => {
        for (const k of blobs.result) mem.blobKeys.add(String(k));
      });
      const meta = tx.objectStore(STORES.meta);
      const cursor = meta.get(META_KEYS.cursor);
      cursor.onsuccess = guard(() => {
        mem.cursor = cursor.result as StoredCursor | undefined;
      });
      const choosable = meta.get(META_KEYS.choosable);
      choosable.onsuccess = guard(() => {
        const rows = choosable.result as { id: string; name: string }[] | undefined;
        if (rows !== undefined) mem.activity.setChoosable(rows);
      });
      const ev = meta.get(META_KEYS.evicted);
      ev.onsuccess = guard(() => {
        evicted = ev.result === true;
      });
    },
  );
  return evicted;
}
