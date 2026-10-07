import { PREF_MAX_ENTRIES, mergePrefs, type Clock, type PrefEntry, type PrefStore } from '@ueberblick/core';
import type { Db } from '../db/driver';

export interface PrefsStore {
  /** The stored record of a person; empty when there is none. */
  get(participantId: string): PrefStore;
  /**
   * Merges `entries` (last write wins per key) into the person's record and returns the merged record. Throws
   * `PrefsFull` when the record would exceed `PREF_MAX_ENTRIES` keys; nothing is written then.
   */
  patch(participantId: string, entries: readonly PrefEntry[]): PrefStore;
  /** Deletes the record (admin reset, erasure). True when there was one. */
  remove(participantId: string): boolean;
}

export class PrefsFull extends Error {
  constructor() {
    super(`A preference record holds at most ${PREF_MAX_ENTRIES} keys.`);
  }
}

export function createPrefsStore(db: Db, clock: Clock): PrefsStore {
  const read = db.prepare<{ record_json: string }>('SELECT record_json FROM prefs WHERE participant_id = ?');
  const write = db.prepare(
    `INSERT INTO prefs (participant_id, record_json, updated) VALUES (?, ?, ?)
     ON CONFLICT (participant_id) DO UPDATE SET record_json = excluded.record_json, updated = excluded.updated`,
  );
  const drop = db.prepare('DELETE FROM prefs WHERE participant_id = ?');
  const get = (id: string): PrefStore => {
    const row = read.get(id);
    return row === undefined ? {} : (JSON.parse(row.record_json) as PrefStore);
  };
  return {
    get,
    patch: (id, entries) =>
      db.transaction(() => {
        const merged = mergePrefs(get(id), entries);
        if (Object.keys(merged).length > PREF_MAX_ENTRIES) throw new PrefsFull();
        write.run(id, JSON.stringify(merged), clock.now());
        return merged;
      }),
    remove: (id) => drop.run(id).changes > 0,
  };
}
