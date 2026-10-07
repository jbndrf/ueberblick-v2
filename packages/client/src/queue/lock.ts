/**
 * `QueueLock` over the Web Locks API (one holder across tabs and workers). The API is a structural port so the
 * queue needs no DOM typings and tests pass a fake. Not supported in the platform: pass `noLock` (single tab).
 */
import type { QueueLock } from './contract';

export interface LockManagerLike {
  request<T>(
    name: string,
    options: { readonly ifAvailable: true },
    callback: (lock: object | null) => Promise<T>,
  ): Promise<T>;
}

export function webQueueLock(locks: LockManagerLike, name: string): QueueLock {
  return {
    tryRun: <T>(fn: () => Promise<T>) =>
      locks.request(name, { ifAvailable: true }, async (lock) =>
        lock === null ? ({ ran: false } as const) : ({ ran: true, value: await fn() } as const),
      ),
  };
}

/** For hosts without Web Locks and a single writer: this tab is the only holder. */
export const noLock: QueueLock = {
  async tryRun<T>(fn: () => Promise<T>) {
    return { ran: true, value: await fn() } as const;
  },
};
