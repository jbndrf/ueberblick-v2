import { describe, expect, it } from 'vitest';
import type { PullResult, SyncStatus, SyncWorker } from './contract';
import { createAutoSync } from './trigger';
import { manualSignal, manualTimers } from './test-server';

/**
 * WP-731: the auto-sync has no retry loop of its own. A failed pull is reported and ends there, so repeated offline
 * attempts neither nest (no promise chain grows) nor leave timers behind.
 */
describe('offline attempts of the auto-sync do not nest', () => {
  it('every failed pull settles on its own; no timer is left pending between attempts', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const worker: SyncWorker = {
      pull: async (): Promise<PullResult> => {
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        try {
          await Promise.resolve();
          throw new TypeError('Failed to fetch');
        } finally {
          inFlight--;
        }
      },
      status: () => ({}) as SyncStatus,
      subscribe: () => () => undefined,
    };
    const timers = manualTimers();
    const online = manualSignal();
    const errors: string[] = [];
    const auto = createAutoSync({
      worker,
      timers,
      doorbell: manualSignal(),
      online,
      visible: manualSignal(),
      onError: (t) => errors.push(t),
    });
    auto.start();
    for (let i = 0; i < 20; i++) {
      online.ring();
      for (let k = 0; k < 5; k++) await Promise.resolve();
    }
    expect(errors.length).toBe(21);
    expect(inFlight).toBe(0);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(timers.pending()).toBe(0);
  });
});
