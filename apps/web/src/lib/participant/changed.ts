/**
 * "Something on the device may have changed", coalesced, and which features when that is known. Sources are the run
 * queue (a queued run may touch any feature: `ALL`) and the device store's change notices (a committed page names its
 * feature ids: only those). A burst inside the window is one call: the union of the ids, or `ALL` when any source
 * said so. The map redraws once per burst, and only for the features a page changed.
 */
import type { Timers } from '@ueberblick/client';
import type { FeatureId } from '@ueberblick/core/model';

/** Any feature may have changed. */
export const ALL = 'all' as const;
export type Changed = typeof ALL | ReadonlySet<FeatureId>;

export interface ChangeFeed {
  subscribe(listener: (changed: Changed) => void): () => void;
  stop(): void;
}

/** A source calls `notify` with the ids that changed, or `ALL`; it returns how to stop listening. */
export type ChangeSource = (notify: (changed: typeof ALL | readonly FeatureId[]) => void) => () => void;

export function changedSignal(
  sources: readonly ChangeSource[],
  timers: Timers,
  windowMs: number,
): ChangeFeed {
  const listeners = new Set<(changed: Changed) => void>();
  let pending: unknown;
  let all = false;
  let ids = new Set<FeatureId>();
  const schedule = (): void => {
    if (pending !== undefined) return;
    pending = timers.set(() => {
      pending = undefined;
      const out: Changed = all ? ALL : ids;
      all = false;
      ids = new Set();
      for (const l of [...listeners]) l(out);
    }, windowMs);
  };
  const offs = sources.map((source) =>
    source((changed) => {
      if (changed === ALL) all = true;
      else for (const id of changed) ids.add(id);
      schedule();
    }),
  );
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    stop() {
      offs.forEach((off) => off());
      if (pending !== undefined) timers.clear(pending);
      pending = undefined;
      listeners.clear();
    },
  };
}
