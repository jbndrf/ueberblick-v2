/**
 * Chunked request issuing inside ONE transaction. `IDBObjectStore.put` clones the value and
 * extracts keys synchronously in the calling task, so 5,000 puts in one loop are one long task.
 * The requests of a page are issued in chunks; the next chunk is issued from the success callback
 * of the previous chunk's last request. The transaction stays alive (a request is pending), the
 * event loop gets a task boundary between chunks, and the page stays atomic.
 */
import type { IdbRequest } from './idb-types';

/**
 * Requests issued per task. Measured in the browser bench `sync-snapshot-60k` (CPU x4, WP-565): a
 * put costs about 70 microseconds at x4 (CDP profile), so 200 requests are one task of about 14 ms,
 * far under the 100 ms budget. Longest task per page, median of 3: 200 -> 141 ms, 100 -> 124 ms,
 * 50 -> 124 ms, 25 -> 67 ms; the remaining spikes are GC pauses, not the put loop, so the chunk size
 * barely moves them. Smaller chunks only add task hops (total 30 s at 200, 41 s at 25).
 */
export const WRITE_CHUNK = 200;

/** A run of requests of one kind: `issue(i)` starts request `i` and returns it. */
export interface RequestSegment {
  readonly length: number;
  issue(index: number): IdbRequest;
}

type Guard = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => void;

/**
 * Issues all segments in chunks of `chunk` requests, then calls `done` (still inside a callback of
 * the transaction, so it may issue the final request). A throw in `issue` or `done` reaches the
 * transaction through `guard`.
 */
export function issueInChunks(
  segments: readonly RequestSegment[],
  guard: Guard,
  done: () => void,
  chunk: number = WRITE_CHUNK,
): void {
  let seg = 0;
  let idx = 0;
  const step = (): void => {
    let last: IdbRequest | undefined;
    let issued = 0;
    while (issued < chunk && seg < segments.length) {
      const s = segments[seg];
      if (!s) break;
      if (idx >= s.length) {
        seg++;
        idx = 0;
        continue;
      }
      last = s.issue(idx++);
      issued++;
    }
    while (seg < segments.length && idx >= (segments[seg]?.length ?? 0)) {
      seg++;
      idx = 0;
    }
    if (!last || seg >= segments.length) {
      // the tail chunk: nothing left to issue, so finish in this task
      done();
      return;
    }
    const inner = last.onsuccess;
    const next = guard(step);
    last.onsuccess = (ev) => {
      inner?.(ev);
      next();
    };
  };
  step();
}

/** Element `i` of an array whose length the caller has checked (a segment's `length`). */
export function at<T>(items: readonly T[], i: number): T {
  const item = items[i];
  if (item === undefined) throw new RangeError(`no request ${i}`);
  return item;
}
