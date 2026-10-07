/** `SyncMeta` on the device database (meta store, keys `syncHead` and `lastSynced`): the worker host has no localStorage. */
import type { Instant, Seq } from '@ueberblick/core/model';
import type { SyncMeta } from './contract';

/** The three meta calls of the writer store this port needs. */
export interface SyncHeadStore {
  readSyncHead(): Promise<number | undefined>;
  writeSyncHead(head: number): Promise<void>;
  clearSyncHead(): Promise<void>;
  readLastSynced(): Promise<string | undefined>;
  writeLastSynced(at: string | undefined): Promise<void>;
}

export function idbSyncMeta(store: SyncHeadStore): SyncMeta {
  return {
    read: async () => {
      const head = await store.readSyncHead();
      return head === undefined ? undefined : { head: head as Seq };
    },
    write: (state) => store.writeSyncHead(state.head),
    clear: () => store.clearSyncHead(),
    readLastSynced: async () => (await store.readLastSynced()) as Instant | undefined,
    writeLastSynced: (at) => store.writeLastSynced(at),
  };
}
