import type { FeatureChange } from '../contract';

/** Features (or ids) per chunk when the initial delivery is spread over several tasks. */
export const CHUNK_SIZE = 4000;

/**
 * Splits one change into parts of at most `size` items, keeping the order add, update, remove.
 * Applying the parts in order equals applying the change. An empty change gives no parts.
 */
export function splitChange(change: FeatureChange, size: number): FeatureChange[] {
  const total = change.add.length + change.update.length + change.remove.length;
  if (total === 0) return [];
  if (total <= size) return [change];
  const parts: FeatureChange[] = [];
  let add = 0;
  let update = 0;
  let remove = 0;
  while (add + update + remove < total) {
    let room = size;
    const a = change.add.slice(add, add + room);
    room -= a.length;
    const u = change.update.slice(update, update + room);
    room -= u.length;
    const r = change.remove.slice(remove, remove + room);
    add += a.length;
    update += u.length;
    remove += r.length;
    parts.push({ add: a, update: u, remove: r });
  }
  return parts;
}

/** Gives the main thread back: the scheduler port of the renderer (deterministic in tests). */
export type YieldToMain = () => Promise<void>;

interface SchedulerLike {
  yield?: () => Promise<void>;
}

export const yieldToMain: YieldToMain = () => {
  const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler;
  if (scheduler?.yield !== undefined) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
};
