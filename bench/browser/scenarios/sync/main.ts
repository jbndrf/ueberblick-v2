// Scenario sync-snapshot-60k: the real device sync host pulls 60 snapshot pages of 1,000 features into an empty
// device store on real IndexedDB (planning, writes and the in-memory index included). The server is in memory.
// `?host=worker` (default) runs the pipeline in a dedicated Web Worker (B-012, WP-567) with a read replica here;
// `?host=inthread` runs it on this thread (the WP-565 baseline). The long-task probe sees only this thread.
// The runner calls `begin()`, waits for `copyDone`, then reads the long tasks and the heap.
import type { Instant } from '@ueberblick/core/model';
import { openSyncHost, SINGLE_TAB, type WorkerPortLike } from '../../../../packages/client/src/host';
import type { IdbEnv } from '../../../../packages/client/src/store/idb-types';
import type { SyncMeta, SyncState } from '../../../../packages/client/src/sync/contract';
import { PAGES, snapshotServer } from '../../lib/sync-world';
import { installProbe, slowdown } from '../../lib/probe';

const bench = installProbe();
const m = bench.metrics;
for (const k of ['beginAt', 'copyDone', 'copyMs', 'pages', 'features']) m[k] = Number.NaN;

const env = { factory: indexedDB, keyRange: IDBKeyRange } as unknown as IdbEnv;
const SLOW_AT = Math.floor(PAGES / 2);
const inThread = new URLSearchParams(location.search).get('host') === 'inthread';
const options = { env, marker: { isInitialised: () => false, markInitialised: () => undefined } };
const predictions = { rederive: () => Promise.resolve() };

let head: SyncState | undefined;
let lastSynced: Instant | undefined;
const meta: SyncMeta = {
  read: () => Promise.resolve(head),
  write: (s) => Promise.resolve(void (head = s)),
  clear: () => Promise.resolve(void (head = undefined)),
  readLastSynced: () => Promise.resolve(lastSynced),
  writeLastSynced: (at) => Promise.resolve(void (lastSynced = at)),
};

async function copy(): Promise<void> {
  const host = inThread
    ? await openSyncHost({
        mode: 'in-thread',
        name: 'bench-sync',
        options,
        transport: snapshotServer(PAGES),
        meta,
        predictions,
        clock: { now: () => new Date().toISOString() as Instant },
      })
    : await openSyncHost({
        mode: 'worker',
        name: 'bench-sync',
        options,
        port: new Worker(new URL('./worker.ts', import.meta.url), {
          type: 'module',
        }) as unknown as WorkerPortLike,
        config: {},
        tabs: SINGLE_TAB,
        predictions,
      });
  // The self-test (`?slow=`) blocks the main thread once, in the middle of the snapshot, on either host.
  let pages = 0;
  host.store.onChange((c) => {
    if (c.kind === 'page' && ++pages === SLOW_AT) slowdown();
  });
  m['beginAt'] = performance.now();
  const r = await host.sync.pull();
  m['copyMs'] = performance.now() - (m['beginAt'] ?? 0);
  m['pages'] = r.pages;
  m['features'] = host.store.featureIdsOfType('tree').length;
  m['copyDone'] = performance.now();
}

bench.begin = () => {
  copy().catch((e: unknown) => bench.errors.push(String(e)));
};

bench.ready = true;
