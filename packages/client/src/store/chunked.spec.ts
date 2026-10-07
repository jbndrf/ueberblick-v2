import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceStoreError } from './codes';
import { WRITE_CHUNK } from './chunked';
import { openDeviceStore } from './open';
import { cursorAt, fakeEnv, feature, fid, memoryMarker, rows, wrapStore } from './test-env';

afterEach(() => vi.restoreAllMocks());

const page = (from: number, n: number) =>
  rows({ features: Array.from({ length: n }, (_, i) => feature(from + i, from + i)) });

describe('chunked page writes', () => {
  it('writes a page of 5,000 features in separate batches with a macrotask boundary between them', async () => {
    const store = await openDeviceStore('p1-chunks', { env: fakeEnv(), marker: memoryMarker() });
    let tick = 0;
    let running = true;
    const spin = () => {
      tick++;
      if (running) setImmediate(spin);
    };
    setImmediate(spin);
    const ticksAtPut: number[] = [];
    wrapStore('put', (next, self) => {
      if (self.name === 'features') ticksAtPut.push(tick);
      return next();
    });
    await store.applyPage(page(1, 5000), cursorAt(5000));
    running = false;
    vi.restoreAllMocks();
    expect(ticksAtPut).toHaveLength(5000);
    expect(new Set(ticksAtPut).size).toBeGreaterThanOrEqual(Math.floor(5000 / WRITE_CHUNK));
    expect(store.cursor()).toEqual(cursorAt(5000));
    expect(store.featureIdsOfType('tree')).toHaveLength(5000);
  });

  it('an abort after chunk k leaves the store and the cursor at the previous page', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await openDeviceStore('p1-chunks', { env, marker });
    await a.applyPage(page(1, 10), cursorAt(10));
    let calls = 0;
    wrapStore('put', (next, self) => {
      if (self.name === 'features' && ++calls === Math.floor(WRITE_CHUNK * 2.5)) throw new Error('boom');
      return next();
    });
    await expect(a.applyPage(page(100, 1000), cursorAt(99))).rejects.toBeInstanceOf(DeviceStoreError);
    vi.restoreAllMocks();
    expect(calls).toBeGreaterThan(WRITE_CHUNK * 2);
    expect(a.cursor()).toEqual(cursorAt(10));
    a.close();
    const b = await openDeviceStore('p1-chunks', { env, marker });
    expect(b.cursor()).toEqual(cursorAt(10));
    expect(b.featureIdsOfType('tree')).toHaveLength(10);
    expect(b.facts.feature(fid(100))).toBeUndefined();
    expect(b.facts.feature(fid(1))).toBeDefined();
  });

  it('puts the cursor last', async () => {
    const store = await openDeviceStore('p1-chunks', { env: fakeEnv(), marker: memoryMarker() });
    const order: string[] = [];
    wrapStore('put', (next, self) => {
      order.push(self.name);
      return next();
    });
    await store.applyPage(page(1, 500), cursorAt(1));
    expect(order.at(-1)).toBe('meta');
    expect(order.filter((n) => n === 'meta')).toHaveLength(1);
  });
});
