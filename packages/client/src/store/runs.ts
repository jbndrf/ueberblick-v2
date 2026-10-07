/**
 * Queue writes on the `runs` store (WP-511): a whole batch in one transaction, state changes, removals.
 * A run row never loses its input: `settle` only adds state fields, `remove` is called by the queue alone.
 */
import type { RunId } from '@ueberblick/core/model';
import type { AppendRunsOptions, RunEntryInput, RunSettlement, StoredRun } from './contract';
import { runTx } from './idb';
import type { IdbDatabase } from './idb-types';
import { RUN_ID_INDEX, STORES } from './schema';

export interface RunRow {
  readonly order: number;
  readonly runId: string;
  readonly run: StoredRun['run'];
  readonly blobs: readonly string[];
  readonly blobMimes: StoredRun['blobMimes'];
  readonly state?: StoredRun['state'];
  readonly group?: string;
  readonly refusal?: StoredRun['refusal'];
  readonly acceptedSeq?: number;
  readonly uploaded?: readonly string[];
}

export const toStoredRun = (r: RunRow): StoredRun => ({
  order: r.order,
  run: r.run,
  blobs: r.blobs,
  blobMimes: r.blobMimes,
  state: r.state ?? 'queued',
  ...(r.group !== undefined ? { group: r.group } : {}),
  ...(r.refusal !== undefined ? { refusal: r.refusal } : {}),
  ...(r.acceptedSeq !== undefined ? { acceptedSeq: r.acceptedSeq } : {}),
  ...(r.uploaded !== undefined ? { uploaded: r.uploaded } : {}),
});

/** Returns the orders in entry order; the blob keys stored are returned so the caller can update its mirror. */
export async function appendRunsTx(
  db: IdbDatabase,
  entries: readonly RunEntryInput[],
  options: AppendRunsOptions,
): Promise<{ readonly orders: readonly number[]; readonly blobKeys: readonly string[] }> {
  const orders: number[] = entries.map(() => -1);
  const blobKeys: string[] = [];
  await runTx(db, [STORES.runs, STORES.blobs], 'readwrite', (tx, guard) => {
    const runs = tx.objectStore(STORES.runs);
    const blobStore = tx.objectStore(STORES.blobs);
    // Requests of one transaction run in order, so the entries get ascending orders.
    entries.forEach((entry, i) => {
      const existing = runs.index(RUN_ID_INDEX).get(entry.run.id);
      existing.onsuccess = guard(() => {
        const found = existing.result as { order: number } | undefined;
        if (found) {
          orders[i] = found.order;
          return;
        }
        for (const b of entry.blobs ?? []) {
          blobStore.put({ sha256: b.sha256, bytes: b.bytes });
          blobKeys.push(b.sha256);
        }
        const row = {
          runId: entry.run.id,
          run: entry.run,
          blobs: (entry.blobs ?? []).map((b) => b.sha256),
          blobMimes: Object.fromEntries((entry.blobs ?? []).map((b) => [b.sha256, b.mime] as const)),
          state: options.state ?? 'queued',
          ...(options.group !== undefined ? { group: options.group } : {}),
          ...(options.refusal !== undefined ? { refusal: options.refusal } : {}),
        };
        const added = runs.add(row);
        added.onsuccess = guard(() => {
          orders[i] = added.result as number;
        });
      });
    });
  });
  return { orders, blobKeys };
}

export async function settleRunsTx(db: IdbDatabase, settlements: readonly RunSettlement[]): Promise<void> {
  if (settlements.length === 0) return;
  await runTx(db, [STORES.runs], 'readwrite', (tx, guard) => {
    const runs = tx.objectStore(STORES.runs);
    for (const s of settlements) {
      const req = runs.index(RUN_ID_INDEX).get(s.runId);
      req.onsuccess = guard(() => {
        const row = req.result as RunRow | undefined;
        if (row === undefined) return;
        runs.put({
          order: row.order,
          runId: row.runId,
          run: row.run,
          blobs: row.blobs,
          blobMimes: row.blobMimes,
          ...(row.group !== undefined ? { group: row.group } : {}),
          state: s.state,
          ...((s.uploaded ?? row.uploaded) ? { uploaded: s.uploaded ?? row.uploaded } : {}),
          ...(s.refusal !== undefined ? { refusal: s.refusal } : {}),
          ...(s.acceptedSeq !== undefined ? { acceptedSeq: s.acceptedSeq } : {}),
        });
      });
    }
  });
}

export async function removeRunsTx(db: IdbDatabase, runIds: readonly RunId[]): Promise<void> {
  if (runIds.length === 0) return;
  await runTx(db, [STORES.runs], 'readwrite', (tx, guard) => {
    const runs = tx.objectStore(STORES.runs);
    for (const id of runIds) {
      const req = runs.index(RUN_ID_INDEX).get(id);
      req.onsuccess = guard(() => {
        const row = req.result as RunRow | undefined;
        if (row !== undefined) runs.delete(row.order);
      });
    }
  });
}
