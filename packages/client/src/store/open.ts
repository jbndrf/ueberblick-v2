/**
 * Opening the device store. Failure paths report a typed error or issue and NEVER delete the
 * database (v3 deleted the queue on open failure: docs/research/v3-device-runtime.md §5 item 1).
 */
import type { StoreErrorCode, StoreOrigin } from '@ueberblick/core/registry';
import { DeviceStoreError } from './codes';
import type { DeviceStore, OpenOptions } from './contract';
import type { IdbDatabase } from './idb-types';
import { MemoryIndex } from './memory';
import { hydrate } from './hydrate';
import { DB_VERSION, META_KEYS, STORES, upgrade } from './schema';
import { DeviceStoreImpl, type StoreRole } from './store';

interface Opened {
  readonly db: IdbDatabase;
  readonly createdNow: boolean;
}

export function openDeviceStore(name: string, options: OpenOptions): Promise<DeviceStore> {
  return openStore(name, options, 'writer');
}

/** The one store of a database on one thread (the in-thread host): applies pages and owns the queue's stores. */
export function openWriterStore(name: string, options: OpenOptions): Promise<DeviceStoreImpl> {
  return openStore(name, options, 'writer');
}

/** The sync worker's store: applies pages, never writes `blobs` (it announces purges). */
export function openCacheWriterStore(name: string, options: OpenOptions): Promise<DeviceStoreImpl> {
  return openStore(name, options, 'cache-writer');
}

/** A read replica (the main thread when the sync worker writes): kept current with `applyNotice`. */
export function openReplicaStore(name: string, options: OpenOptions): Promise<DeviceStoreImpl> {
  return openStore(name, options, 'replica');
}

async function openStore(name: string, options: OpenOptions, role: StoreRole): Promise<DeviceStoreImpl> {
  const { env, marker, onIssue } = options;
  const wasInitialised = marker.isInitialised();
  const { db, createdNow } = await openDatabase(name, options, wasInitialised);

  const holder: { store?: DeviceStoreImpl } = {};
  const raise = (code: StoreErrorCode, message: string) => {
    holder.store?.markUnavailable();
    onIssue?.({ code, message });
  };
  db.onversionchange = () => {
    db.close(); // let the other tab upgrade; nothing is deleted
    raise('version_change', 'Another tab is upgrading the database; this tab must reload.');
  };
  db.onclose = () =>
    raise('terminated', 'The browser closed the database connection. Queued runs stay exportable.');

  const mem = new MemoryIndex();
  const evictedMeta = await hydrate(db, mem).catch((e: unknown) => {
    db.close();
    throw e;
  });
  const origin: StoreOrigin = createdNow
    ? wasInitialised
      ? 'evicted'
      : 'fresh'
    : evictedMeta
      ? 'evicted'
      : 'existing';
  marker.markInitialised();
  const store = new DeviceStoreImpl(db, env, name, origin, mem, role);
  holder.store = store;
  return store;
}

function openDatabase(name: string, options: OpenOptions, wasInitialised: boolean): Promise<Opened> {
  const { env, onIssue } = options;
  return new Promise((resolve, reject) => {
    const failed = (cause: unknown) =>
      reject(
        new DeviceStoreError(
          'open_failed',
          'The device database could not be opened; it was left untouched.',
          { cause },
        ),
      );
    let createdNow = false;
    let req;
    try {
      req = env.factory.open(name, DB_VERSION);
    } catch (e) {
      failed(e);
      return;
    }
    req.onupgradeneeded = (ev) => {
      const tx = req.transaction;
      if (!tx) return;
      createdNow = ev.oldVersion === 0;
      upgrade(req.result, tx, ev.oldVersion);
      // an empty database on a device that was initialised before: remember it until acknowledged
      if (createdNow && wasInitialised) tx.objectStore(STORES.meta).put(true, META_KEYS.evicted);
    };
    req.onblocked = () =>
      onIssue?.({ code: 'blocked', message: 'Another tab blocks the database upgrade; close other tabs.' });
    req.onsuccess = () => resolve({ db: req.result, createdNow });
    req.onerror = () => failed(req.error);
  });
}

export { readRunsForExport } from './export';
