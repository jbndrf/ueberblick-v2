/** The test and fallback backend: data lives in this object, so a second `openToolDataStore` on it is a reload. */
import { deviceClone } from '../testing/clone';
import type {
  OutboxEntry,
  StoredToolRecord,
  ToolDataBackend,
  ToolDataSnapshot,
  ToolDataWrite,
} from './contract';

export interface MemoryBackend extends ToolDataBackend {
  /** How many writes were committed (tests count them). */
  readonly writes: number;
}

const clone = deviceClone;

export function memoryBackend(): MemoryBackend {
  const records = new Map<string, StoredToolRecord>();
  const outbox = new Map<number, OutboxEntry>();
  const meta = new Map<string, ToolDataSnapshot['meta'][string]>();
  let order = 0;
  let writes = 0;
  return {
    get writes() {
      return writes;
    },
    async load() {
      return clone({
        records: [...records.values()],
        outbox: [...outbox.values()],
        meta: Object.fromEntries(meta),
      });
    },
    async write(w: ToolDataWrite) {
      writes++;
      for (const d of w.deleteRecords ?? []) records.delete(`${d.tool}\u0000${d.seq}`);
      for (const r of w.records ?? []) records.set(`${r.tool}\u0000${r.seq}`, clone(r));
      for (const o of w.putOutbox ?? []) outbox.set(o.order, clone(o));
      for (const k of w.deleteOutbox ?? []) outbox.delete(k);
      let added: number | undefined;
      if (w.addOutbox) {
        added = ++order;
        outbox.set(added, { ...clone(w.addOutbox), order: added });
      }
      for (const [k, v] of Object.entries(w.meta ?? {})) {
        if (v === null) meta.delete(k);
        else meta.set(k, clone(v));
      }
      return added === undefined ? {} : { order: added };
    },
    close() {},
  };
}
