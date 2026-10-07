/**
 * `DraftStore` of the task sheet: one draft per key, kept in `localStorage` (a few hundred bytes of form values; the
 * unsent runs themselves live in IndexedDB). The store is per participant and project, so two people on one device
 * never see each other's drafts. Storage is a port; a write that fails rejects, so the sheet never claims a draft it
 * does not have.
 */
import type { DraftStore } from '@ueberblick/ui';
import { fileHashes, withoutFiles, type DraftBlobs } from './blobs';
import { draftKeyPrefix } from './device-names';

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function previousHashes(raw: string): readonly string[] {
  try {
    return fileHashes(JSON.parse(raw) as Record<string, never>);
  } catch {
    return [];
  }
}

export function createDraftStore(storage: StoragePort, scope: string, blobs?: DraftBlobs): DraftStore {
  const at = (key: string): string => `${draftKeyPrefix(scope)}${key}`;
  // shelf rows of drafts that are gone (a forget that failed) are swept once, before the first draft operation
  let swept: Promise<void> | undefined;
  const ready = async (): Promise<void> => {
    swept ??= blobs?.sweep((k) => storage.getItem(at(k)) !== null).catch(() => undefined);
    await swept;
  };
  return {
    async get(key) {
      await ready();
      const raw = storage.getItem(at(key));
      if (raw === null) return undefined;
      let values: Record<string, never>;
      try {
        values = JSON.parse(raw) as Record<string, never>;
      } catch {
        storage.removeItem(at(key)); // a damaged draft is dropped, not shown
        return undefined;
      }
      if (blobs === undefined) return values;
      // the photos of the draft come back with it (WP-811); a photo whose bytes are gone is removed from the draft, so
      // the form shows it as missing instead of claiming it, and a later submit cannot reference bytes it lacks
      const missing = await blobs.restore(values).catch(() => fileHashes(values));
      return withoutFiles(values, missing) as Record<string, never>;
    },
    async put(key, values) {
      await ready();
      await blobs?.persist(key, values); // bytes first: a draft never claims a photo it cannot restore
      const before = storage.getItem(at(key));
      storage.setItem(at(key), JSON.stringify(values));
      if (blobs === undefined || before === null) return;
      // shelf rows of photos the previous version had and this one dropped
      const kept = new Set(fileHashes(values));
      const dropped = previousHashes(before).filter((sha256) => !kept.has(sha256));
      await blobs.forget(key, { dropped: dropped.map((sha256) => ({ sha256 })) }).catch(() => undefined);
    },
    async drop(key) {
      await ready();
      const raw = storage.getItem(at(key));
      storage.removeItem(at(key));
      if (raw === null || blobs === undefined) return;
      let values: Record<string, never>;
      try {
        values = JSON.parse(raw) as Record<string, never>;
      } catch {
        return; // an unreadable draft names no photos; the sweep at the next open or the sign-out wipe removes its rows
      }
      await blobs.forget(key, values).catch(() => undefined); // a failed forget is swept at the next open
    },
  };
}
