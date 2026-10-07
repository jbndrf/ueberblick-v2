import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Instant } from '@ueberblick/core/model';
import type { SyncResetReason } from '@ueberblick/core/registry';
import { fakeEnv, fid, memoryMarker } from '../store/test-env';
import type { DeviceStoreImpl } from '../store/store';
import { FakeServer, memoryMeta } from '../sync/test-server';
import type { BroadcastChannelLike } from './tabs';
import { openWorkerHost, type SyncHost } from './proxy';
import { serveSyncHost } from './serve';
import { FakeBus, FakeLocks } from './test-tabs';
import { browserTabs, InsecureContextError } from './tabs-browser';

const clock = { now: () => '2026-09-29T10:00:00Z' as Instant };

/** Several tabs on one device database: one env, one meta, one lock manager, one bus; a worker each. */
function world() {
  const env = fakeEnv();
  const meta = memoryMeta();
  const server = new FakeServer();
  const locks = new FakeLocks();
  const bus = new FakeBus();
  const inits: string[] = [];
  const rederived: Record<string, SyncResetReason[]> = {};
  const writers = new Map<string, () => DeviceStoreImpl | undefined>();

  async function tab(tabId: string, onFault?: (e: Error) => void): Promise<SyncHost> {
    const { port1, port2 } = new MessageChannel();
    rederived[tabId] = [];
    const served = serveSyncHost(port1 as never, () => {
      inits.push(tabId);
      return { env, transport: server, meta, clock };
    });
    writers.set(tabId, () => served.writer());
    return openWorkerHost({
      name: 'p1-a',
      options: { env, marker: memoryMarker() },
      port: port2 as never,
      config: {},
      predictions: {
        rederive: (r) => {
          rederived[tabId]?.push(r);
          return Promise.resolve();
        },
      },
      ...(onFault ? { onFault } : {}),
      tabs: { locks, channel: bus.channel(), tabId },
      onDispose: () => {
        port1.close();
        port2.close();
      },
    });
  }
  return { env, server, locks, bus, inits, rederived, writers, tab };
}

const featuresOf = (h: SyncHost) => h.store.featureIdsOfType('tree').length;

describe('one tab pulls per database', () => {
  it('only the lock holder runs a worker; both replicas see every page', async () => {
    const w = world();
    for (let n = 1; n <= 5; n++) w.server.write(n);
    const a = await w.tab('a');
    const b = await w.tab('b');
    expect(w.inits).toEqual(['a']);
    await a.sync.pull();
    await vi.waitFor(() => expect(featuresOf(b)).toBe(5));
    expect(featuresOf(a)).toBe(5);
    expect(b.store.cursor()).toEqual(a.store.cursor());
    expect(w.writers.get('b')?.()).toBeUndefined();
    // the follower's status follows the holder's
    await vi.waitFor(() => expect(b.sync.status()).toMatchObject({ phase: 'idle', featuresLoaded: 5 }));
    a.dispose();
    b.dispose();
  });

  it('the follower opens without waiting for the lock and runs no sync work on its own', async () => {
    const w = world();
    const a = await w.tab('a');
    const requestsBefore = w.server.requests.length;
    const b = await w.tab('b');
    expect(w.inits).toEqual(['a']);
    expect(w.server.requests.length).toBe(requestsBefore);
    a.dispose();
    b.dispose();
  });

  it("a follower's doorbell (pull) is forwarded to the holder and answered with its result", async () => {
    const w = world();
    for (let n = 1; n <= 3; n++) w.server.write(n);
    const a = await w.tab('a');
    const b = await w.tab('b');
    await expect(b.sync.pull()).resolves.toMatchObject({ reset: 'first_sync' });
    expect(w.inits).toEqual(['a']);
    await vi.waitFor(() => expect(featuresOf(b)).toBe(3));
    w.server.write(4);
    await expect(b.sync.pull()).resolves.toMatchObject({ reset: undefined });
    await vi.waitFor(() => expect(featuresOf(a)).toBe(4));
    a.dispose();
    b.dispose();
  });

  it("a holder's reset reaches the follower's run queue as a rederive", async () => {
    const w = world();
    w.server.write(1);
    const a = await w.tab('a');
    const b = await w.tab('b');
    await a.sync.pull();
    await vi.waitFor(() => expect(w.rederived['b']).toEqual(['first_sync']));
    expect(w.rederived['a']).toEqual(['first_sync']);
    a.dispose();
    b.dispose();
  });

  it('a follower doorbell error comes back typed', async () => {
    const w = world();
    w.server.failOn = () => new Error('boom');
    const a = await w.tab('a');
    const b = await w.tab('b');
    await expect(b.sync.pull()).rejects.toBeInstanceOf(Error);
    a.dispose();
    b.dispose();
  });

  it('handover: when the holder closes the second tab takes over from the stored cursor, no page lost or duplicated', async () => {
    const w = world();
    for (let n = 1; n <= 5; n++) w.server.write(n);
    const a = await w.tab('a');
    const b = await w.tab('b');
    await a.sync.pull();
    await vi.waitFor(() => expect(featuresOf(b)).toBe(5));
    const cursor = a.store.cursor();
    a.dispose();
    await vi.waitFor(() => expect(w.inits).toEqual(['a', 'b']));
    w.server.write(6);
    w.server.write(7);
    const seen = w.server.requests.length;
    await vi.waitFor(async () => {
      await b.sync.pull();
      expect(featuresOf(b)).toBe(7);
    });
    // the new holder resumed from the stored cursor: a delta, not a second snapshot
    const asked = w.server.requests.slice(seen);
    expect(asked[0]).toMatchObject({ since: cursor?.cursor });
    expect(asked.every((r) => r.since > 0)).toBe(true);
    expect(b.store.facts.feature(fid(6))).toBeDefined();
    expect(b.store.facts.feature(fid(7))).toBeDefined();
    b.dispose();
  });

  it('a third tab keeps following across a handover', async () => {
    const w = world();
    w.server.write(1);
    const a = await w.tab('a');
    const b = await w.tab('b');
    const c = await w.tab('c');
    await a.sync.pull();
    a.dispose();
    await vi.waitFor(() => expect(w.inits).toEqual(['a', 'b']));
    w.server.write(2);
    await b.sync.pull();
    await vi.waitFor(() => expect(featuresOf(c)).toBe(2));
    // a doorbell of the third tab reaches the new holder
    w.server.write(3);
    await c.sync.pull();
    await vi.waitFor(() => expect(featuresOf(b)).toBe(3));
    b.dispose();
    c.dispose();
  });

  it('the holder dies mid-page: the follower that takes over converges, with no half page and no stale discard', async () => {
    const w = world();
    w.server.pageSize = 2000;
    for (let n = 1; n <= 1500; n++) w.server.write(n);
    const faults: Error[] = [];
    const a = await w.tab('a');
    const b = await w.tab('b', (e) => faults.push(e));
    // only the first slice of a page reaches the follower before the holder is gone
    const isLaterSlice = (d: unknown) => {
      const m = d as { ch: string; data?: { kind?: string; notice?: { part?: { index: number } } } };
      return m.ch === 'feed' && m.data?.kind === 'change' && (m.data.notice?.part?.index ?? 0) > 0;
    };
    w.bus.filter = (d) => !isLaterSlice(d);
    await a.sync.pull();
    await vi.waitFor(() => expect(b.store.pageInFlight()).toBe(true));
    expect(featuresOf(b)).toBeLessThan(1500);
    // The takeover is over when the new holder announces itself on the bus: that comes after its re-read of the
    // database and after its worker started. Neither `pageInFlight()` (false while the re-read is under way, with the
    // mirror half loaded and no cursor yet) nor the `reloaded` notice (the worker is not started yet, a pull would be
    // refused) marks that moment.
    let announced!: () => void;
    const takenOver = new Promise<void>((resolve) => (announced = resolve));
    a.dispose();
    w.bus.filter = (d) => {
      if ((d as { ch: string }).ch === 'holder') announced();
      return true;
    };
    await vi.waitFor(() => expect(w.inits).toEqual(['a', 'b']));
    await takenOver;
    expect(b.store.pageInFlight()).toBe(false);
    expect(featuresOf(b)).toBe(1500);
    expect(new Set(b.store.featureIdsOfType('tree')).size).toBe(1500);
    expect(b.store.cursor()).toMatchObject({ cursor: 1500 });
    // the next multi-slice page applies whole: nothing left over from the dead holder's page is discarded
    for (let n = 1501; n <= 2800; n++) w.server.write(n);
    await b.sync.pull();
    expect(featuresOf(b)).toBe(2800);
    expect(b.store.pageInFlight()).toBe(false);
    expect(faults.filter((e) => !/re-reading the database/.test(e.message))).toEqual([]);
    b.dispose();
  });

  it('a follower that closes before it ever held the lock leaves the line', async () => {
    const w = world();
    const a = await w.tab('a');
    const b = await w.tab('b');
    b.dispose();
    a.dispose();
    await new Promise((r) => setTimeout(r, 10));
    expect(w.inits).toEqual(['a']);
  });
});

describe('the lock port is structural', () => {
  it('only the browser adapter names navigator or BroadcastChannel', () => {
    const dir = new URL('.', import.meta.url);
    const users = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .filter((f) => /\bnavigator\b|new BroadcastChannel/.test(readFileSync(new URL(f, dir), 'utf8')));
    expect(users).toEqual(['tabs-browser.ts']);
  });
});

describe('browserTabs', () => {
  it('builds the port from the platform and refuses a platform without it', () => {
    const locks = new FakeLocks();
    const bus = new FakeBus();
    const names: string[] = [];
    const Channel = function (n: string) {
      names.push(n);
      return bus.channel();
    } as unknown as new (name: string) => BroadcastChannelLike;
    const t = browserTabs('p1-a', {
      navigator: { locks },
      BroadcastChannel: Channel,
      crypto: { randomUUID: () => 'x' },
    });
    expect(t).toMatchObject({ locks, tabId: 'x' });
    expect(names).toEqual(['ueberblick-sync:p1-a']);
    expect(() => browserTabs('p1-a', {})).toThrow(/Web Locks/);
  });

  it('throws the typed InsecureContextError outside a secure context, before anything else is checked', () => {
    const locks = new FakeLocks();
    const platform = {
      isSecureContext: false,
      navigator: { locks },
      BroadcastChannel: function () {} as unknown as new (name: string) => BroadcastChannelLike,
      crypto: { randomUUID: () => 'x' },
    };
    expect(() => browserTabs('p1-a', platform)).toThrow(InsecureContextError);
    expect(() => browserTabs('p1-a', { isSecureContext: false })).toThrow(InsecureContextError);
    // A secure context that still lacks the APIs stays the plain error.
    expect(() => browserTabs('p1-a', { isSecureContext: true })).toThrow(/Web Locks/);
    expect(() => browserTabs('p1-a', { isSecureContext: true })).not.toThrow(InsecureContextError);
  });
});
