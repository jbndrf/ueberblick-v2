/** Writes one planned page and its cursor in ONE readwrite transaction, in chunks (WP-565). */
import { edgeKey } from '@ueberblick/core/fold';
import type { FeatureId } from '@ueberblick/core/model';
import { SYNC_OBSERVATION_HISTORY } from '@ueberblick/core/sync';
import type { StoredCursor } from './contract';
import { at, issueInChunks, type RequestSegment } from './chunked';
import { releaseRuns, runIdOf, sweepRange } from './history-gc';
import { runTx } from './idb';
import type { IdbDatabase, IdbEnv, IdbRequest } from './idb-types';
import type { PagePlan } from './plan';
import { META_KEYS, STORES } from './schema';

const MAX_SEQ = Number.MAX_SAFE_INTEGER;

export function writePlan(db: IdbDatabase, env: IdbEnv, plan: PagePlan, cursor: StoredCursor): Promise<void> {
  const { keyRange } = env;
  const stores = [STORES.features, STORES.edges, STORES.history, STORES.runMeta, STORES.people, STORES.meta];
  return runTx(db, stores, 'readwrite', (tx, guard) => {
    const features = tx.objectStore(STORES.features);
    const edges = tx.objectStore(STORES.edges);
    const history = tx.objectStore(STORES.history);
    const runMeta = tx.objectStore(STORES.runMeta);
    const people = tx.objectStore(STORES.people);
    /** Run ids of the history rows this page deleted: their run rows go when nothing references them. */
    const released = new Set<string>();
    let pendingSweeps = 0;
    let issuedAll = false;
    const maybeFinish = () => {
      if (!issuedAll || pendingSweeps > 0) return;
      releaseRuns(history, runMeta, env, released, guard, () =>
        tx.objectStore(STORES.meta).put(cursor, META_KEYS.cursor),
      );
    };
    const sweepDone = () => {
      pendingSweeps--;
      maybeFinish();
    };
    const trim = (id: FeatureId, property: string): IdbRequest => {
      const range = keyRange.bound([id, property], [id, property, MAX_SEQ]);
      const count = history.count(range);
      pendingSweeps++;
      count.onsuccess = guard(() => {
        if (count.result <= SYNC_OBSERVATION_HISTORY) return sweepDone();
        const cur = history.openCursor(range, 'prev');
        let skipped = false;
        cur.onsuccess = guard(() => {
          const c = cur.result;
          if (!c) return sweepDone();
          if (!skipped) {
            skipped = true;
            c.advance(SYNC_OBSERVATION_HISTORY);
            return;
          }
          released.add(runIdOf(c.value));
          c.delete();
          c.continue();
        });
      });
      return count;
    };
    const dropHistoryOf = (id: FeatureId): IdbRequest => {
      pendingSweeps++;
      return sweepRange(history, keyRange.bound([id], [id, []]), guard, (r) => released.add(r), sweepDone);
    };
    const segments: RequestSegment[] = [
      {
        length: plan.featureDeletes.length,
        issue: (i) => {
          const id = at(plan.featureDeletes, i);
          dropHistoryOf(id);
          return features.delete(id);
        },
      },
      { length: plan.edgeDeletes.length, issue: (i) => edges.delete(at(plan.edgeDeletes, i)) },
      { length: plan.featurePuts.length, issue: (i) => features.put(at(plan.featurePuts, i)) },
      {
        length: plan.edgePuts.length,
        issue: (i) => edges.put({ ...at(plan.edgePuts, i), key: edgeKey(at(plan.edgePuts, i)) }),
      },
      { length: plan.peoplePuts.length, issue: (i) => people.put(at(plan.peoplePuts, i)) },
      {
        length: plan.choosable === undefined ? 0 : 1,
        issue: () => tx.objectStore(STORES.meta).put(plan.choosable, META_KEYS.choosable),
      },
      { length: plan.runPuts.length, issue: (i) => runMeta.put(at(plan.runPuts, i)) },
      { length: plan.historyPuts.length, issue: (i) => history.put(at(plan.historyPuts, i)) },
      { length: plan.trimPairs.length, issue: (i) => trim(...at(plan.trimPairs, i)) },
    ];
    // the cursor goes last: once every chunk is issued and every trim and sweep has finished
    issueInChunks(segments, guard, () => {
      issuedAll = true;
      maybeFinish();
    });
  });
}
