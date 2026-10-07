// The thumbnail cache of the device (WP-667, v3 "Offline-Bilder"): low-resolution copies of photos that other people
// made, kept so images show offline. Not the run queue's `blobs` store: that holds the bytes of the device's own
// queued uploads, keyed by the original's sha256, written together with a run and purged with it. A thumbnail has
// other bytes than its original and is rebuildable from the server, so it lives in its own small database, and
// switching Offline-Bilder off drops all of it (v3 `deleteDownloadedFiles`).
import type { ThumbSizeKey } from '@ueberblick/core/registry';

/** The one size kept: v3 saved `?thumb=800x0f`, the registry's `preview`. The list size is drawn from it. */
export const CACHED_THUMB_SIZE: ThumbSizeKey = 'preview';

/** Most thumbnail bytes kept (a thumbnail is about 50 KB, so about 5,000 photos); the download stops there. */
export const THUMB_CACHE_MAX_BYTES = 256 * 1024 * 1024;

/** At most this many thumbnails are fetched at once, so a slow phone keeps its connection for the sync. */
export const THUMB_FETCH_CONCURRENCY = 3;

export interface ThumbCache {
  /** False where the browser has no IndexedDB: nothing is stored, `get` finds nothing. */
  readonly supported: boolean;
  get(sha256: string): Promise<Blob | undefined>;
  has(sha256: string): Promise<boolean>;
  put(sha256: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** The "Dateien" count of Speicher: thumbnails on the device. */
  count(): Promise<number>;
  /** Their total size in bytes. */
  bytes(): Promise<number>;
  /** Every cached sha256. */
  keys(): Promise<readonly string[]>;
  remove(sha256: string): Promise<void>;
  clear(): Promise<void>;
}

/** The server's thumbnail of one photo; undefined when it has none (not an image, no access, gone). Rejects offline. */
export interface ThumbTransport {
  fetch(sha256: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mime: string } | undefined>;
}

export interface ThumbProgress {
  /** Thumbnails handled so far (stored, skipped or failed) out of those asked for. */
  readonly done: number;
  readonly total: number;
}
