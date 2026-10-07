import type { RunId } from '@ueberblick/core/model';
import type { Json } from '../../form/contract';
import type { DraftStore, TimerPort, RunDraft, RunProgress, RunSubmitter } from '../contract';

/** In-memory ports for tests. The real ones are the run queue (WP-511) and an IndexedDB store. */
export function memoryDrafts(seed: Record<string, Record<string, Json>> = {}): DraftStore & {
  readonly map: Map<string, Record<string, Json>>;
} {
  const map = new Map(Object.entries(seed));
  return {
    map,
    get: async (k) => map.get(k),
    put: async (k, v) => void map.set(k, { ...v }),
    drop: async (k) => void map.delete(k),
  };
}

export interface FakeSubmitter extends RunSubmitter {
  readonly submitted: RunDraft[];
  /** Pushes a progress to the listeners of a run, as the run queue would after syncing. */
  push(runId: RunId, progress: RunProgress): void;
}

export function fakeSubmitter(delayMs = 0): FakeSubmitter {
  const submitted: RunDraft[] = [];
  const listeners = new Map<RunId, Set<(p: RunProgress) => void>>();
  const last = new Map<RunId, RunProgress>();
  return {
    submitted,
    submit: async (run) => {
      submitted.push(run);
      last.set(run.id, { state: 'queued' });
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return 'queued';
    },
    outcome: (id, fn) => {
      const set = listeners.get(id) ?? new Set();
      listeners.set(id, set);
      set.add(fn);
      const now = last.get(id);
      if (now) fn(now);
      return () => set.delete(fn);
    },
    push: (id, p) => {
      last.set(id, p);
      for (const fn of listeners.get(id) ?? []) fn(p);
    },
  };
}

/** Deterministic run ids shaped like UUIDv7 (version nibble 7). */
export function fakeIds(): { runId(): RunId; readonly minted: () => number } {
  let n = 0;
  return {
    runId: () => `018f0000-0000-7000-8000-${String(++n).padStart(12, '0')}` as RunId,
    minted: () => n,
  };
}

/** A timer port that only fires when the test advances it. */
export function fakeTimer(): TimerPort & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let next = 0;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  return {
    set: (fn, ms) => {
      jobs.set(++next, { at: now + ms, fn });
      return next;
    },
    clear: (h) => void jobs.delete(h as number),
    pending: () => jobs.size,
    advance(ms) {
      now += ms;
      for (const [h, j] of [...jobs]) {
        if (j.at <= now) {
          jobs.delete(h);
          j.fn();
        }
      }
    },
  };
}
