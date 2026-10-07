/** The sync worker keeps the live config versions: follow each header, prune after a completed pull (WP-669). */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Instant } from '@ueberblick/core/model';
import { countingFetcher } from '../config/retain.testing';
import { versionsSink } from '../config/sink';
import { openConfigVersions } from '../config/versions';
import { openDeviceStore } from '../store/open';
import { fakeEnv, fid, key, memoryMarker, rid } from '../store/test-env';
import type { SyncTransport } from './contract';
import { createSyncWorker } from './worker';
import { FakeServer, memoryMeta } from './test-server';

const queuedAt = (n: number, configVersion: number) => ({
  id: rid(n),
  task: key('t'),
  actor: { id: 'a', kind: 'participant' as const, roles: [] },
  configVersion,
  featureId: fid(1),
  input: {},
});

interface Live {
  deployed: number;
  live: readonly number[];
}

async function setup(live: Live, queued: readonly number[] = []) {
  const server = new FakeServer();
  server.write(1);
  const header = { current: live, offline: false };
  const transport: SyncTransport = {
    fetchPage: async (r) => {
      if (header.offline) throw new Error('offline');
      const p = await server.fetchPage(r);
      return { ...p, header: { ...p.header, versions: header.current } };
    },
  };
  const store = await openDeviceStore('w', { env: fakeEnv(), marker: memoryMarker() });
  for (const [i, v] of queued.entries()) await store.appendRun(queuedAt(i + 1, v));
  const fetcher = countingFetcher();
  const config = await openConfigVersions({ store, fetcher });
  const worker = createSyncWorker({
    store,
    transport,
    meta: memoryMeta(),
    predictions: { rederive: () => Promise.resolve() },
    clock: { now: () => '2026-09-29T10:00:00Z' as Instant },
    config: versionsSink({ versions: config, store }),
  });
  const stored = async () => (await store.readConfigVersions()).map((r) => r.version).sort((a, b) => a - b);
  return { worker, config, fetcher, header, stored };
}

describe('sync worker and config versions', () => {
  it('a pull prefetches every live version once and deployed follows the header', async () => {
    const k = await setup({ deployed: 5, live: [3, 5] });
    await k.worker.pull();
    await k.config.refresh();
    expect(k.fetcher.calls.slice().sort()).toEqual([3, 5]);
    expect(await k.stored()).toEqual([3, 5]);
    expect(k.config.deployed).toBe(5);
    await k.worker.pull();
    expect(k.fetcher.calls).toHaveLength(2);
  });

  it('a version that left the live set is pruned after the pull unless a queued run references it', async () => {
    const k = await setup({ deployed: 1, live: [1, 2, 3] }, [2]);
    await k.worker.pull();
    await k.config.refresh();
    expect(await k.stored()).toEqual([1, 2, 3]);
    k.header.current = { deployed: 3, live: [3] };
    await k.worker.pull();
    expect(await k.stored()).toEqual([2, 3]); // 1 gone; 2 kept for the queued run
  });

  it('a failed pull prunes nothing (offline)', async () => {
    const k = await setup({ deployed: 1, live: [1, 2] });
    await k.worker.pull();
    await k.config.refresh();
    k.header.current = { deployed: 2, live: [2] };
    k.header.offline = true;
    await expect(k.worker.pull()).rejects.toThrow('offline');
    expect(await k.stored()).toEqual([1, 2]);
    k.header.offline = false;
    await k.worker.pull();
    expect(await k.stored()).toEqual([2]);
  });

  it('property: after a pull the stored versions are (fetched) ∩ (live ∪ queued)', async () => {
    const versions = fc.integer({ min: 1, max: 6 });
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(versions, { minLength: 1 }),
        fc.uniqueArray(versions, { minLength: 1 }),
        fc.array(versions, { maxLength: 4 }),
        async (first, second, queued) => {
          const k = await setup({ deployed: first[0] as number, live: first }, queued);
          await k.worker.pull();
          await k.config.refresh();
          k.header.current = { deployed: second[0] as number, live: second };
          await k.worker.pull();
          await k.config.refresh();
          const keep = new Set([...second, ...queued]);
          const expected = new Set([...first, ...second].filter((v) => keep.has(v)));
          expect(await k.stored()).toEqual([...expected].sort((a, b) => a - b));
        },
      ),
      { numRuns: 20 },
    );
  });
});
