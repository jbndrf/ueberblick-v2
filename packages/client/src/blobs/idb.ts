// The browser's ThumbCache: one small IndexedDB database of its own (see `contract.ts` for why it is not the run
// queue's `blobs` store). Rows are `{ sha256, bytes, mime }`, bytes as a Uint8Array so every engine can clone them.
import { requestResult, runTx } from '../store/idb';
import type { IdbDatabase, IdbEnv } from '../store/idb-types';
import type { ThumbCache } from './contract';

const STORE = 'thumbs';

interface Row {
  readonly sha256: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
}

function open(env: IdbEnv, name: string): Promise<IdbDatabase> {
  return new Promise((resolve, reject) => {
    const req = env.factory.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'sha256' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error(req.error?.message ?? 'cannot open the thumbnail cache'));
    req.onblocked = () => reject(new Error('the thumbnail cache is blocked by another tab'));
  });
}

const UNSUPPORTED: ThumbCache = {
  supported: false,
  get: async () => undefined,
  has: async () => false,
  put: async () => undefined,
  count: async () => 0,
  bytes: async () => 0,
  keys: async () => [],
  remove: async () => undefined,
  clear: async () => undefined,
};

/** `name` is per project and person (the caller composes it), so one device can hold several. */
export function idbThumbCache(env: IdbEnv | undefined, name: string): ThumbCache {
  if (env === undefined) return UNSUPPORTED;
  let opened: Promise<IdbDatabase> | undefined;
  const db = (): Promise<IdbDatabase> =>
    (opened ??= open(env, name).then((d) => {
      // Abmelden deletes this database (WP-769): an open connection would block that delete, so let it go.
      d.onversionchange = () => {
        d.close();
        opened = undefined;
      };
      return d;
    }));
  const store = async (mode: 'readonly' | 'readwrite') =>
    (await db()).transaction(STORE, mode).objectStore(STORE);

  return {
    supported: true,
    async get(sha256) {
      const row = (await requestResult((await store('readonly')).get(sha256))) as Row | undefined;
      return row === undefined ? undefined : new Blob([new Uint8Array(row.bytes)], { type: row.mime });
    },
    async has(sha256) {
      return (await requestResult((await store('readonly')).count(sha256 as never))) > 0;
    },
    async put(sha256, bytes, mime) {
      const row: Row = { sha256, bytes, mime };
      await runTx(await db(), [STORE], 'readwrite', (tx) => void tx.objectStore(STORE).put(row));
    },
    async count() {
      return requestResult((await store('readonly')).count());
    },
    async bytes() {
      const rows = (await requestResult((await store('readonly')).getAll())) as Row[];
      return rows.reduce((n, r) => n + r.bytes.length, 0);
    },
    async keys() {
      return (await requestResult((await store('readonly')).getAllKeys())) as string[];
    },
    async remove(sha256) {
      await runTx(await db(), [STORE], 'readwrite', (tx) => void tx.objectStore(STORE).delete(sha256));
    },
    async clear() {
      await runTx(await db(), [STORE], 'readwrite', (tx) => void tx.objectStore(STORE).clear());
    },
  };
}
