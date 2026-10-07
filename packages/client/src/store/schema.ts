/**
 * IndexedDB layout. Queued runs and their blobs are the only irreplaceable data: no upgrade,
 * open failure or cache clear may touch the `runs`, `blobs` or `predictions` stores destructively.
 */
import type { IdbDatabase, IdbTransaction } from './idb-types';

export const STORES = {
  features: 'features',
  edges: 'edges',
  history: 'history',
  runs: 'runs',
  blobs: 'blobs',
  predictions: 'predictions',
  meta: 'meta',
  configVersions: 'configVersions',
  runMeta: 'runMeta',
  people: 'people',
} as const;

/** Rebuildable from the server: what "clear cache" drops. Config versions are not in it: queued runs need them. */
export const CACHE_STORES = [
  STORES.features,
  STORES.edges,
  STORES.history,
  STORES.runMeta,
  STORES.people,
] as const;

export const META_KEYS = {
  cursor: 'cursor',
  evicted: 'evicted',
  syncHead: 'syncHead',
  lastSynced: 'lastSynced',
  /** The choosable participants (WP-725), replaced as a whole by the page that carries them. */
  choosable: 'choosable',
} as const;

export const RUN_ID_INDEX = 'runId';
/** `history` by run id: tells whether a run row is still referenced after a trim (WP-602). */
export const HISTORY_RUN_INDEX = 'runId';

/**
 * One step of the schema history. `up` may add stores and indexes only; it never deletes or rewrites
 * `runs`, `blobs` or `predictions` (docs/07). Append a step and the version follows; never edit one.
 */
export interface Migration {
  readonly version: number;
  readonly up: (db: IdbDatabase, tx: IdbTransaction) => void;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.createObjectStore(STORES.features, { keyPath: 'id' });
      db.createObjectStore(STORES.edges, { keyPath: 'key' });
      // one row per (feature, property, seq): range reads by prefix serve history and the cap
      db.createObjectStore(STORES.history, { keyPath: ['featureId', 'property', 'seq'] });
      const runs = db.createObjectStore(STORES.runs, { keyPath: 'order', autoIncrement: true });
      runs.createIndex(RUN_ID_INDEX, 'runId', { unique: true });
      db.createObjectStore(STORES.blobs, { keyPath: 'sha256' });
      db.createObjectStore(STORES.predictions, { keyPath: 'runId' });
      db.createObjectStore(STORES.meta);
    },
  },
  {
    // compiled config versions kept for queued runs (WP-514); one row per config version number
    version: 2,
    up: (db) => {
      db.createObjectStore(STORES.configVersions, { keyPath: 'version' });
    },
  },
  {
    // run rows and names from the sync (WP-601/602): the Aktivität timeline of a feature; add-only
    version: 3,
    up: (db, tx) => {
      db.createObjectStore(STORES.runMeta, { keyPath: 'id' });
      db.createObjectStore(STORES.people, { keyPath: 'id' });
      tx.objectStore(STORES.history).createIndex(HISTORY_RUN_INDEX, 'runId');
    },
  },
];

const newest = MIGRATIONS[MIGRATIONS.length - 1];
if (!newest) throw new Error('MIGRATIONS must not be empty');
export const DB_VERSION: number = newest.version;

/** Runs every step newer than `oldVersion`, in order. */
export function upgrade(db: IdbDatabase, tx: IdbTransaction, oldVersion: number): void {
  for (const m of MIGRATIONS) if (m.version > oldVersion) m.up(db, tx);
}
