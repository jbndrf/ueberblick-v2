import type { Blobs, Clock } from '@ueberblick/core';
import type { Db } from '../db/driver';
import { assertSha256, type BlobStore, type ByteSource, type StoredBlob } from './store';

export interface BlobService extends Blobs {
  /** Streams the bytes in. With `expectedSha256` a different hash is rejected (BlobHashMismatch). Same bytes twice store one blob. */
  put(source: ByteSource, mime: string, expectedSha256?: string): Promise<StoredBlob>;
  get(
    sha256: string,
  ): { readonly mime: string; readonly bytes: number; readonly stream: ByteSource } | undefined;
}

export function createBlobs(deps: { db: Db; store: BlobStore; clock: Clock }): BlobService {
  const { db, store, clock } = deps;
  const insert = db.prepare(
    'INSERT OR IGNORE INTO blobs (sha256, mime, bytes, created_at) VALUES (?, ?, ?, ?)',
  );
  const row = db.prepare<{ mime: string; bytes: number }>('SELECT mime, bytes FROM blobs WHERE sha256 = ?');
  return {
    has(sha256) {
      assertSha256(sha256);
      return row.get(sha256) !== undefined && store.has(sha256);
    },
    async put(source, mime, expectedSha256) {
      const stored = await store.write(source, expectedSha256);
      insert.run(stored.sha256, mime, stored.bytes, clock.now());
      return stored;
    },
    get(sha256) {
      assertSha256(sha256);
      const meta = row.get(sha256);
      const stream = meta && store.read(sha256);
      return meta && stream ? { mime: meta.mime, bytes: meta.bytes, stream } : undefined;
    },
  };
}
