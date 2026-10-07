/**
 * The host adapter (B-012): the app chooses where the device sync pipeline runs. `in-thread` is the engine on the
 * calling thread; `worker` is a dedicated Web Worker with a read replica on the main thread. Both give the same
 * `SyncHost`: a `DeviceStore` to read through and a `SyncWorker` to pull with. There is no automatic fallback:
 * a worker that cannot start is an error (R11).
 */
import { IN_THREAD, type WORKER } from './kinds';
import { openInThreadHost, type InThreadHostOptions } from './in-thread';
import { openWorkerHost, type SyncHost, type WorkerHostOptions } from './proxy';

export type SyncHostOptions =
  | ({ readonly mode: typeof IN_THREAD } & InThreadHostOptions)
  | ({ readonly mode: typeof WORKER } & WorkerHostOptions);

export function openSyncHost(o: SyncHostOptions): Promise<SyncHost> {
  return o.mode === IN_THREAD ? openInThreadHost(o) : openWorkerHost(o);
}

export { openInThreadHost, openWorkerHost };
export { serveSyncHost, type ServedHost, type WorkerSideDeps, type WorkerSideFactory } from './serve';
export type { InThreadHostOptions, SyncHost, WorkerHostOptions };
export type { WorkerPortLike } from './proxy';
export { browserTabs, InsecureContextError } from './tabs-browser';
export {
  syncLockName,
  type BroadcastChannelLike,
  type SyncLockManagerLike,
  type TabCoordination,
} from './tabs';
export * from './protocol';
export { HOST_KINDS, IN_THREAD, SINGLE_TAB, WORKER, type HostKind } from './kinds';
