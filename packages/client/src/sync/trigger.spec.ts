import { describe, expect, it } from 'vitest';
import type { PullResult, SyncStatus, SyncWorker } from './contract';
import { createAutoSync } from './trigger';
import { manualSignal, manualTimers } from './test-server';

function fakeWorker(fail = false) {
  const w = {
    calls: 0,
    pull: () => {
      w.calls++;
      return fail
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({
            pages: 0,
            reset: undefined,
            cursor: 0,
          } satisfies PullResult);
    },
    status: () => ({}) as SyncStatus,
    subscribe: () => () => undefined,
  };
  return w satisfies SyncWorker & { calls: number };
}

function rig(fail = false) {
  const worker = fakeWorker(fail);
  const timers = manualTimers();
  const doorbell = manualSignal();
  const online = manualSignal();
  const visible = manualSignal();
  const errors: string[] = [];
  const auto = createAutoSync({
    worker,
    timers,
    doorbell,
    online,
    visible,
    onError: (t) => errors.push(t),
  });
  return { worker, timers, doorbell, online, visible, auto, errors };
}

describe('auto sync', () => {
  it('pulls on open', () => {
    const r = rig();
    r.auto.start();
    expect(r.worker.calls).toBe(1);
  });

  it('a doorbell burst collapses to one pull after the debounce', () => {
    const r = rig();
    r.auto.start();
    for (let i = 0; i < 20; i++) {
      r.doorbell.ring();
      r.timers.advance(100);
    }
    expect(r.worker.calls).toBe(1); // still inside the window
    r.timers.advance(500);
    expect(r.worker.calls).toBe(2);
    r.timers.advance(5_000);
    expect(r.worker.calls).toBe(2);
  });

  it('online and visibilitychange pull at once (no doorbell needed)', () => {
    const r = rig();
    r.auto.start();
    r.online.ring();
    r.visible.ring();
    expect(r.worker.calls).toBe(3);
  });

  it('stop unsubscribes and drops a pending doorbell pull', () => {
    const r = rig();
    r.auto.start();
    r.doorbell.ring();
    r.auto.stop();
    r.timers.advance(1_000);
    r.online.ring();
    expect(r.worker.calls).toBe(1);
    expect(r.doorbell.listeners + r.online.listeners + r.visible.listeners).toBe(0);
  });

  it('a failing pull is reported with its trigger and never thrown', async () => {
    const r = rig(true);
    r.auto.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(r.errors).toEqual(['open']);
  });
});
