// The dedicated worker of the device sync pipeline (WP-567, B-012): the sync engine, the page decoding and the
// IndexedDB cache writes run here, off the main thread. Started by `browser.ts` (`new Worker(new URL(...))`).
import { serveSyncHost, type IdbEnv, type MessagePortLike } from '@ueberblick/client';
import type { Instant } from '@ueberblick/core/model';
import { createWorkerSide } from './sync-worker-side';

serveSyncHost(
  self as unknown as MessagePortLike,
  createWorkerSide({
    fetch: (input, init) => fetch(input, { credentials: 'same-origin', ...init }),
    env: { factory: indexedDB, keyRange: IDBKeyRange } as unknown as IdbEnv,
    now: () => new Date().toISOString() as Instant,
  }),
);
