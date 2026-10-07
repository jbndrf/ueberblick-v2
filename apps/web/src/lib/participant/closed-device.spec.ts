import { describe, expect, it, vi } from 'vitest';
import type { DeviceStore, RunQueue, StoredRun } from '@ueberblick/client';
import { silentWhenClosed } from './closed-device';

function parts() {
  const listeners = new Set<() => void>();
  const row = {} as StoredRun;
  const store = { readRuns: vi.fn(async () => [row]), marker: 'kept' } as unknown as DeviceStore;
  const queue = {
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    status: () => 'idle',
  } as unknown as RunQueue;
  return { store, queue, ring: () => listeners.forEach((l) => l()), row };
}

describe('silentWhenClosed (WP-792)', () => {
  it('passes everything through while the device is open', async () => {
    const p = parts();
    const heard = vi.fn();
    const d = silentWhenClosed(p.store, p.queue, () => false);
    d.queue.subscribe(heard);
    p.ring();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(await d.store.readRuns()).toEqual([p.row]);
    expect((d.store as unknown as { marker: string }).marker).toBe('kept');
  });

  it('rings nobody and reads no runs once closed, without touching the closed store', async () => {
    const p = parts();
    let closed = false;
    const heard = vi.fn();
    const d = silentWhenClosed(p.store, p.queue, () => closed);
    d.queue.subscribe(heard);
    closed = true;
    p.ring();
    expect(heard).not.toHaveBeenCalled();
    expect(await d.store.readRuns()).toEqual([]);
    expect(p.store.readRuns).not.toHaveBeenCalled();
  });
});
