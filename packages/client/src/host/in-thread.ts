/**
 * The in-thread sync host: today's wiring (Node, tests, and browsers where the app chooses it). The store is the
 * writer and the sync engine runs on the calling thread; `onChange` fires from the store itself.
 */
import type { Instant } from '@ueberblick/core/model';
import type { OpenOptions } from '../store/contract';
import { openWriterStore } from '../store/open';
import type { DeviceStoreImpl } from '../store/store';
import type { VersionsSink } from '../config';
import type { PredictionRefresher, SyncMeta, SyncTransport } from '../sync/contract';
import { idbSyncMeta } from '../sync/idb-meta';
import { createSyncWorker } from '../sync/worker';
import type { SyncHost } from './proxy';

export interface InThreadHostOptions {
  readonly name: string;
  readonly options: OpenOptions;
  readonly transport: SyncTransport;
  readonly predictions: PredictionRefresher;
  readonly clock: { now(): Instant };
  /** Where the page headers' config versions go (WP-669); `versionsSink` over `ConfigVersions` and the store. */
  readonly versions?: VersionsSink;
  /** Default: the `syncHead` key of the device database. */
  readonly meta?: SyncMeta;
}

export async function openInThreadHost(
  o: InThreadHostOptions,
): Promise<SyncHost & { readonly writer: DeviceStoreImpl }> {
  const store = await openWriterStore(o.name, o.options);
  const sync = createSyncWorker({
    store,
    transport: o.transport,
    meta: o.meta ?? idbSyncMeta(store),
    predictions: o.predictions,
    clock: o.clock,
    ...(o.versions ? { config: o.versions } : {}),
  });
  await sync.restore();
  return { store, writer: store, sync, dispose: () => store.close() };
}
