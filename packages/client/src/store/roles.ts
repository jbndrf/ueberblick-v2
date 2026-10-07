/**
 * Who owns which IndexedDB writes of one database (B-012). Internal tags of the store, not domain values.
 * - `writer`: everything, on one thread (the in-thread host, Node, tests).
 * - `cache-writer`: the sync worker: cache writes only. It announces blob purges; `blobs` is queue data and stays main-only.
 * - `replica`: the main thread beside a cache-writer: mirrors its commits, refuses cache writes, owns `blobs` and `runs`.
 */
export const STORE_ROLES = ['writer', 'cache-writer', 'replica'] as const;
export type StoreRole = (typeof STORE_ROLES)[number];
