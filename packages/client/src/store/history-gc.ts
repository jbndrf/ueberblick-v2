/**
 * Deleting history rows and the run rows they leave unreferenced (WP-602). A run row (`runMeta`) lives only as
 * long as a history row names its run, so every delete of history collects the run ids it removed and, once
 * the deletes are done, drops the run rows no history row references any more (the `history.runId` index).
 */
import { runTx } from './idb';
import type { IdbDatabase, IdbEnv, IdbObjectStore, IdbRequest } from './idb-types';
import { HISTORY_RUN_INDEX, STORES } from './schema';

type Guard = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => void;

const MAX_SEQ = Number.MAX_SAFE_INTEGER;

/** The run id of a history row seen by a cursor. */
export const runIdOf = (value: unknown): string => (value as { readonly runId: string }).runId;

/**
 * Deletes every history row in `range` with a cursor, telling `onRun` each run id. Returns a request that
 * fires once (the chunked issuer chains on it); `onDone` runs after the last row.
 */
export function sweepRange(
  history: IdbObjectStore,
  range: unknown,
  guard: Guard,
  onRun: (runId: string) => void,
  onDone: () => void,
): IdbRequest {
  const count = history.count(range);
  count.onsuccess = guard(() => {
    const cur = history.openCursor(range);
    cur.onsuccess = guard(() => {
      const c = cur.result;
      if (!c) return onDone();
      onRun(runIdOf(c.value));
      c.delete();
      c.continue();
    });
  });
  return count;
}

/** Drops the run rows of `runIds` that no history row references. `done` runs after the last check. */
export function releaseRuns(
  history: IdbObjectStore,
  runMeta: IdbObjectStore,
  env: IdbEnv,
  runIds: Iterable<string>,
  guard: Guard,
  done: () => void,
): void {
  const ids = [...runIds];
  if (ids.length === 0) return done();
  let left = ids.length;
  for (const id of ids) {
    const n = history.index(HISTORY_RUN_INDEX).count(env.keyRange.only(id));
    n.onsuccess = guard(() => {
      if (n.result === 0) runMeta.delete(id);
      if (--left === 0) done();
    });
  }
}

/** `dropHistory`: removes these properties' history of one feature and releases the run rows they leave. */
export function dropHistoryTx(
  db: IdbDatabase,
  env: IdbEnv,
  featureId: string,
  properties: readonly string[],
): Promise<void> {
  return runTx(db, [STORES.history, STORES.runMeta], 'readwrite', (tx, guard) => {
    const history = tx.objectStore(STORES.history);
    const runMeta = tx.objectStore(STORES.runMeta);
    const runs = new Set<string>();
    let left = properties.length;
    if (left === 0) return;
    for (const p of properties) {
      const range = env.keyRange.bound([featureId, p], [featureId, p, MAX_SEQ]);
      sweepRange(
        history,
        range,
        guard,
        (r) => runs.add(r),
        () => {
          if (--left === 0) releaseRuns(history, runMeta, env, runs, guard, () => undefined);
        },
      );
    }
  });
}
