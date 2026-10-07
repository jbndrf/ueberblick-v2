/** Blob uploaders (WP-757): written by the PUT route after the bytes are proven, read by HEAD and the run transaction. */
import type { Actor, Clock } from '@ueberblick/core';
import type { Db } from '../../db/driver';

export interface BlobUploads {
  /** Idempotent: a retried or repeated upload is the same row. */
  record(actor: Pick<Actor, 'id' | 'kind'>, sha256: string): void;
  uploadedBy(actor: Pick<Actor, 'id' | 'kind'>, sha256: string): boolean;
}

export function createBlobUploads(db: Db, clock: Clock): BlobUploads {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO blob_uploads (sha256, actor, actor_kind, created_at) VALUES (?, ?, ?, ?)',
  );
  const has = db.prepare('SELECT 1 AS x FROM blob_uploads WHERE sha256 = ? AND actor = ? AND actor_kind = ?');
  return {
    record: (actor, sha256) => void insert.run(sha256, actor.id, actor.kind, clock.now()),
    uploadedBy: (actor, sha256) => has.get(sha256, actor.id, actor.kind) !== undefined,
  };
}
