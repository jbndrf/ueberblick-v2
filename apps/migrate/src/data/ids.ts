/**
 * Run ids are derived from the v3 record, not drawn at random: converting the same export twice gives the same run
 * ids, so a run that the store already holds is answered from its ledger and written once (F3). That is what makes
 * a resumed conversion safe.
 */
import { createHash } from 'node:crypto';
import type { FeatureId, RunId } from '@ueberblick/core';
import type { Checkpoint, IdMap } from './types';

/** A UUID-shaped id (version 7 layout) from the hash of `seed`. */
export function runIdFor(...seed: readonly (string | number)[]): RunId {
  const h = createHash('sha256').update(seed.join('\u0000')).digest('hex');
  const variant = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}` as RunId;
}

/** The id under which a run of a refused batch is submitted alone (a refused batch leaves its ids rejected). */
export const singleRunId = (id: RunId): RunId => runIdFor(id, 'single');

export function createIdMap(from: Checkpoint['ids'] = {}): IdMap {
  const map = new Map<string, FeatureId>(Object.entries(from));
  return {
    get: (v3Id) => map.get(v3Id),
    set: (v3Id, id) => void map.set(v3Id, id),
    entries: () => map.entries(),
  };
}

/** The state to store between batches: the next batch and the ids so far. O(features): store it every so often. */
export function checkpoint(next: number, ids: IdMap): Checkpoint {
  return { next, ids: Object.fromEntries(ids.entries()) };
}
