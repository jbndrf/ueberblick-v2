// The sync worker of the sync-snapshot-60k scenario: the real serve side (writer store, sync engine) on real
// IndexedDB, with the in-memory snapshot server generated here (`lib/sync-world.ts` is pure).
import type { Instant } from '@ueberblick/core/model';
import { serveSyncHost } from '../../../../packages/client/src/host/serve';
import type { IdbEnv } from '../../../../packages/client/src/store/idb-types';
import type { MessagePortLike } from '../../../../packages/client/src/sync/decode';
import { PAGES, snapshotServer } from '../../lib/sync-world';

serveSyncHost(self as unknown as MessagePortLike, () => ({
  env: { factory: indexedDB, keyRange: IDBKeyRange } as unknown as IdbEnv,
  transport: snapshotServer(PAGES),
  clock: { now: () => new Date().toISOString() as Instant },
}));
