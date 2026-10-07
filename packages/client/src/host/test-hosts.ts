/** Test helper: the same sync host on the in-thread variant and on the worker variant (a MessageChannel in one process). Tests only. */
import type { Instant } from '@ueberblick/core/model';
import type { SyncResetReason } from '@ueberblick/core/registry';
import type { DeviceStoreImpl } from '../store/store';
import type { IdbEnv } from '../store/idb-types';
import { memoryMarker } from '../store/test-env';
import type { VersionsSink } from '../config';
import type { SyncMeta, SyncTransport } from '../sync/contract';
import { IN_THREAD, SINGLE_TAB, type HostKind } from './kinds';
import { openInThreadHost } from './in-thread';
import { openWorkerHost, type SyncHost } from './proxy';
import { serveSyncHost } from './serve';

export interface TestHostDeps {
  readonly transport: SyncTransport;
  readonly env: IdbEnv;
  readonly meta: SyncMeta;
  readonly rederived: SyncResetReason[];
  readonly onFault?: (e: Error) => void;
  readonly versions?: VersionsSink;
}

export type TestHost = SyncHost & {
  /** The store that owns the cache writes: the same object as `store` in-thread, the worker's store otherwise. */
  readonly writer: DeviceStoreImpl;
};

const clock = { now: () => '2026-09-29T10:00:00Z' as Instant };

export async function openTestHost(kind: HostKind, deps: TestHostDeps): Promise<TestHost> {
  const predictions = {
    rederive: (r: SyncResetReason) => {
      deps.rederived.push(r);
      return Promise.resolve();
    },
  };
  const options = { env: deps.env, marker: memoryMarker() };
  if (kind === IN_THREAD)
    return openInThreadHost({
      name: 'p1-a',
      options,
      transport: deps.transport,
      meta: deps.meta,
      predictions,
      clock,
      ...(deps.versions ? { versions: deps.versions } : {}),
    });
  const { port1, port2 } = new MessageChannel();
  const served = serveSyncHost(port1 as never, () => ({
    env: deps.env,
    transport: deps.transport,
    meta: deps.meta,
    clock,
  }));
  const host = await openWorkerHost({
    name: 'p1-a',
    options,
    port: port2 as never,
    config: {},
    tabs: SINGLE_TAB,
    predictions,
    ...(deps.versions ? { versions: deps.versions } : {}),
    ...(deps.onFault ? { onFault: deps.onFault } : {}),
    onDispose: () => {
      port1.close();
      port2.close();
    },
  });
  return {
    ...host,
    get writer() {
      return served.writer() as DeviceStoreImpl;
    },
  };
}
