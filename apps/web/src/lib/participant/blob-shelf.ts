/**
 * Where the bytes of a draft's photos survive a reload (WP-811). A draft is form values in `localStorage` (drafts.ts);
 * its `{ sha256 }` file values need their bytes too, or a restored draft shows no photo. The shelf is its own small
 * IndexedDB database per participant (`draftBlobsName`), so the queue's `blobs` store stays the queue's and the wipe at
 * sign-out drops it together with the other databases. Bytes are kept as an ArrayBuffer plus their mime type.
 */
import type { IdbEnv } from '@ueberblick/client';
import { createPendingBlobs, type BlobShelf, type PendingBlobs } from './blobs';
import { draftBlobsName } from './device-names';

type IdbDatabase = ReturnType<IdbEnv['factory']['open']>['result'];
type IdbObjectStore = ReturnType<ReturnType<IdbDatabase['transaction']>['objectStore']>;
interface IdbTransaction {
  readonly error: { readonly message: string } | null;
  objectStore(name: string): IdbObjectStore;
  oncomplete: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onabort: ((ev: unknown) => void) | null;
}
interface IdbRequest<T> {
  readonly result: T;
  readonly error: { readonly message: string } | null;
  onsuccess: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

const STORE = 'draft-blobs';

interface Row {
  readonly sha256: string;
  readonly bytes: ArrayBuffer;
  readonly mime: string;
  /** Keys of the drafts that hold this photo; the bytes go when the last one lets go (WP-813). */
  readonly drafts?: readonly string[];
}

function request<T>(req: IdbRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error(req.error?.message ?? 'indexeddb request failed'));
  });
}

export function createIdbBlobShelf(env: IdbEnv, project: string, participant: string): BlobShelf {
  let opened: Promise<IdbDatabase> | undefined;
  const open = (): Promise<IdbDatabase> => {
    opened ??= new Promise((resolve, reject) => {
      const req = env.factory.open(draftBlobsName(project, participant), 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'sha256' });
      req.onsuccess = () => {
        // a delete (sign-out wipe) or an upgrade elsewhere must not stay blocked by this connection
        req.result.onversionchange = () => {
          req.result.close();
          opened = undefined;
        };
        resolve(req.result);
      };
      req.onerror = () => {
        opened = undefined;
        reject(new Error(req.error?.message ?? 'cannot open the draft photo store'));
      };
    });
    return opened;
  };
  const store = async (mode: 'readonly' | 'readwrite'): Promise<IdbObjectStore> =>
    (await open()).transaction(STORE, mode).objectStore(STORE);
  /** Runs one write and resolves when its transaction has committed, not when the request succeeded. */
  const write = async (run: (s: IdbObjectStore) => void): Promise<void> => {
    const tx = (await open()).transaction(STORE, 'readwrite') as unknown as IdbTransaction;
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(tx.error?.message ?? 'indexeddb write failed'));
      tx.onabort = () => reject(new Error(tx.error?.message ?? 'indexeddb write aborted'));
    });
    run(tx.objectStore(STORE));
    await done;
  };
  return {
    async put(sha256, blob, mime, draftKey) {
      const bytes = await blob.arrayBuffer();
      await write((st) => {
        const got = st.get(sha256) as unknown as IdbRequest<Row | undefined>;
        got.onsuccess = () => {
          const drafts = new Set(got.result?.drafts ?? []).add(draftKey);
          const row: Row = { sha256, bytes, mime, drafts: [...drafts] };
          st.put(row);
        };
      });
    },
    async get(sha256) {
      const row = (await request((await store('readonly')).get(sha256))) as Row | undefined;
      return row === undefined
        ? undefined
        : { blob: new Blob([row.bytes], { type: row.mime }), mime: row.mime };
    },
    async remove(sha256, draftKey) {
      await write((st) => {
        const got = st.get(sha256) as unknown as IdbRequest<Row | undefined>;
        got.onsuccess = () => {
          const row = got.result;
          if (row === undefined) return;
          const drafts = (row.drafts ?? []).filter((k) => k !== draftKey);
          if (drafts.length === 0) st.delete(sha256);
          else st.put({ ...row, drafts });
        };
      });
    },
    async sweep(isLive) {
      await write((st) => {
        const all = st.getAll() as unknown as IdbRequest<readonly Row[]>;
        all.onsuccess = () => {
          for (const row of all.result) {
            const drafts = (row.drafts ?? []).filter(isLive);
            if (drafts.length === 0) st.delete(row.sha256);
            else if (drafts.length !== row.drafts?.length) st.put({ ...row, drafts });
          }
        };
      });
    },
    close() {
      const db = opened;
      opened = undefined;
      void db?.then(
        (d) => d.close(),
        () => undefined,
      );
    },
  };
}

/** The pending blobs of one device: bytes in memory, drafts' photos on the IndexedDB shelf (`onDevice`: the store's). */
export function createDeviceBlobs(
  env: IdbEnv,
  project: string,
  participant: string,
  onDevice: (sha256: string) => boolean,
): PendingBlobs {
  return createPendingBlobs(createIdbBlobShelf(env, project, participant), onDevice);
}

export type { PendingBlobs };
