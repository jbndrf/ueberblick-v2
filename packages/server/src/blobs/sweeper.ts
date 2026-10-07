/**
 * Finishes blob deletions after a crash (WP-142). An erasure commits the removal of the `blobs` row together with a
 * `blob` tombstone; the bytes are deleted only after that commit. If the process dies in between, the bytes are
 * orphaned but the tombstone remains: this re-derives the pending set from it, so no extra table is needed.
 * A blob whose row exists again (the same bytes uploaded after the erasure) is never touched.
 */
import type { Db } from '../db/driver';
import type { BlobStore } from './store';

export interface BlobSweeper {
  /** `blob` tombstones with no blob row whose bytes are still stored, sorted. */
  pending(): string[];
  /** Deletes the bytes of `pending()` (idempotent) and returns their ids. Run at startup. */
  sweep(): Promise<string[]>;
}

export function createBlobSweeper(deps: { db: Db; store: BlobStore }): BlobSweeper {
  const { db, store } = deps;
  const erased = db.prepare<{ id: string }>(
    `SELECT DISTINCT t.id FROM tombstones t
     WHERE t.kind = 'blob' AND NOT EXISTS (SELECT 1 FROM blobs b WHERE b.sha256 = t.id) ORDER BY t.id`,
  );
  const pending = (): string[] => erased.all().flatMap((r) => (store.has(r.id) ? [r.id] : []));
  return {
    pending,
    async sweep() {
      const ids = pending();
      if (ids.length > 0) await store.delete(ids);
      return ids;
    },
  };
}
