/**
 * Tool data on IndexedDB: its own database (`<name>-tooldata`) so `clearCache` of the feature store never
 * touches the outbox. Stores: `records` (key tool+seq), `outbox` (auto-increment `order`), `meta`.
 * One transaction per write. Schema steps only add stores (like the device store, docs/07).
 */
import type { IdbDatabase, IdbEnv, IdbRequest, IdbTransaction } from '../store/idb-types';
import type {
  OutboxEntry,
  StoredToolRecord,
  ToolDataBackend,
  ToolDataSnapshot,
  ToolDataWrite,
} from './contract';

const RECORDS = 'records';
const OUTBOX = 'outbox';
const META = 'meta';
const VERSION = 1;

const done = <T>(r: IdbRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new Error(r.error?.message ?? 'IndexedDB request failed'));
  });

const committed = (tx: IdbTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(tx.error?.message ?? 'IndexedDB transaction failed'));
    tx.onabort = () => reject(new Error(tx.error?.message ?? 'IndexedDB transaction aborted'));
  });

export function idbBackend(env: IdbEnv, name: string): ToolDataBackend {
  let opened: Promise<IdbDatabase> | undefined;
  const open = (): Promise<IdbDatabase> =>
    (opened ??= new Promise<IdbDatabase>((resolve, reject) => {
      const req = env.factory.open(`${name}-tooldata`, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore(RECORDS, { keyPath: ['tool', 'seq'] });
        db.createObjectStore(OUTBOX, { keyPath: 'order', autoIncrement: true });
        db.createObjectStore(META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(new Error(req.error?.message ?? 'The tool data database could not be opened'));
      req.onblocked = () => reject(new Error('The tool data database is blocked by another tab'));
    }));

  return {
    async load() {
      const db = await open();
      const tx = db.transaction([RECORDS, OUTBOX, META], 'readonly');
      const records = done(tx.objectStore(RECORDS).getAll()) as Promise<StoredToolRecord[]>;
      const outbox = done(tx.objectStore(OUTBOX).getAll()) as Promise<OutboxEntry[]>;
      const keys = done(tx.objectStore(META).getAllKeys());
      const values = done(tx.objectStore(META).getAll());
      const [r, o, k, v] = await Promise.all([records, outbox, keys, values]);
      const meta: Record<string, ToolDataSnapshot['meta'][string]> = {};
      k.forEach((key, i) => {
        meta[String(key)] = v[i] as ToolDataSnapshot['meta'][string];
      });
      return { records: r, outbox: o, meta };
    },
    async write(w: ToolDataWrite) {
      const db = await open();
      const tx = db.transaction([RECORDS, OUTBOX, META], 'readwrite');
      const finished = committed(tx);
      const records = tx.objectStore(RECORDS);
      const outbox = tx.objectStore(OUTBOX);
      const meta = tx.objectStore(META);
      for (const d of w.deleteRecords ?? []) records.delete([d.tool, d.seq]);
      for (const r of w.records ?? []) records.put(r);
      for (const o of w.putOutbox ?? []) outbox.put(o);
      for (const k of w.deleteOutbox ?? []) outbox.delete(k);
      const added = w.addOutbox ? done(outbox.add({ ...w.addOutbox })) : undefined;
      for (const [k, v] of Object.entries(w.meta ?? {})) {
        if (v === null) meta.delete(k);
        else meta.put(v, k);
      }
      await finished;
      return added ? { order: Number(await added) } : {};
    },
    close() {
      void opened?.then((db) => db.close());
      opened = undefined;
    },
  };
}
