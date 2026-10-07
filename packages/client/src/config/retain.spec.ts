import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CompiledConfigData } from '@ueberblick/core/hydrate';
import { openDeviceStore } from '../store/open';
import { fakeEnv, memoryMarker } from '../store/test-env';
import type { ConfigFetcher, ConfigStorePort } from './contract';
import { compiledWorld, countingFetcher } from './retain.testing';
import { openConfigVersions } from './versions';

const setup = () => openDeviceStore('c', { env: fakeEnv(), marker: memoryMarker() });
type Store = Awaited<ReturnType<typeof setup>>;
const stored = async (s: Store) => (await s.readConfigVersions()).map((r) => r.version).sort((a, b) => a - b);
const none = () => Promise.resolve([] as number[]);

/** A promise settled by hand: the tests interleave header, retain and enqueue deterministically. */
function gate<T = void>() {
  let open: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (open = r));
  return { promise, open };
}

describe('ConfigVersions.follow / retain (WP-669)', () => {
  it('a header with live [3, 5] fetches 3 and 5 once; both are readable offline afterwards', async () => {
    const store = await setup();
    const f = countingFetcher();
    const cv = await openConfigVersions({ store, fetcher: f });
    cv.follow({ deployed: 5, live: [3, 5] });
    cv.follow({ deployed: 5, live: [3, 5] }); // the next page header: nothing is fetched again
    await cv.refresh();
    expect(f.calls.slice().sort()).toEqual([3, 5]);
    f.offline = true;
    const again = await openConfigVersions({ store, fetcher: f }); // a restart, offline
    expect(again.get(3)).not.toBe('refetching');
    expect(again.get(5)).not.toBe('refetching');
    again.follow({ deployed: 5, live: [3, 5] });
    await again.refresh();
    expect(f.calls).toHaveLength(2); // stored and readable: not fetched again
  });

  it('deployed follows the header and is undefined before the first one', async () => {
    const cv = await openConfigVersions({ store: await setup(), fetcher: countingFetcher() });
    expect(cv.deployed).toBeUndefined();
    cv.follow({ deployed: 2, live: [2] });
    expect(cv.deployed).toBe(2);
    cv.follow({ deployed: 4, live: [2, 4] });
    expect(cv.deployed).toBe(4);
  });

  it('retain drops stored and in-memory versions that are neither live nor queued', async () => {
    const store = await setup();
    const f = countingFetcher();
    const cv = await openConfigVersions({ store, fetcher: f });
    cv.follow({ deployed: 3, live: [1, 2, 3] });
    await cv.refresh();
    cv.follow({ deployed: 3, live: [2, 3] });
    await cv.retain(none);
    expect(await stored(store)).toEqual([2, 3]);
    f.offline = true;
    expect(cv.get(2)).not.toBe('refetching');
    expect(cv.get(1)).toBe('refetching'); // gone: wanted again, waits (existing behaviour)
  });

  it('retain before the first header does nothing: the live set is unknown', async () => {
    const store = await setup();
    await store.putConfigVersion(4, compiledWorld());
    const cv = await openConfigVersions({ store, fetcher: countingFetcher() });
    await cv.retain(none);
    expect(await stored(store)).toEqual([4]);
  });

  it('a fetch in flight for a dropped version is discarded', async () => {
    const store = await setup();
    const held = new Map<number, ReturnType<typeof gate<CompiledConfigData>>>();
    const fetcher: ConfigFetcher = {
      fetchCompiled: (v) => {
        const g = gate<CompiledConfigData>();
        held.set(v, g);
        return g.promise;
      },
    };
    const cv = await openConfigVersions({ store, fetcher });
    cv.follow({ deployed: 9, live: [9] });
    cv.follow({ deployed: 10, live: [10] });
    await cv.retain(none);
    held.get(9)?.open(compiledWorld());
    held.get(10)?.open(compiledWorld());
    await cv.refresh();
    expect(await stored(store)).toEqual([10]);
    expect(cv.awaiting()).toEqual([]);
  });

  describe('races (controlled promises, no timers)', () => {
    it('a header that arrives while retain reads the queue keeps its version, and the version is stored', async () => {
      const store = await setup();
      const cv = await openConfigVersions({ store, fetcher: countingFetcher() });
      cv.follow({ deployed: 1, live: [1] });
      await cv.refresh();
      const queueRead = gate<number[]>();
      const retained = cv.retain(() => queueRead.promise);
      cv.follow({ deployed: 2, live: [1, 2] }); // the newer header, after retain started
      queueRead.open([]);
      await retained;
      await cv.refresh();
      expect(await stored(store)).toEqual([1, 2]);
      expect(cv.get(2)).not.toBe('refetching');
    });

    it('a version a queued run names at the read is kept, in the store and in memory', async () => {
      const store = await setup();
      const f = countingFetcher();
      const cv = await openConfigVersions({ store, fetcher: f });
      cv.follow({ deployed: 5, live: [4, 5] });
      await cv.refresh();
      cv.follow({ deployed: 5, live: [5] });
      const queued = [4]; // a run enqueued before the read
      await cv.retain(() => Promise.resolve(queued));
      f.offline = true;
      expect(await stored(store)).toEqual([4, 5]);
      expect(cv.get(4)).not.toBe('refetching');
    });

    it('a version wanted again while retain deletes keeps its row (a run is enqueued mid-retain)', async () => {
      const real = await setup();
      const listing = gate();
      let reads = 0;
      const store: ConfigStorePort = {
        putConfigVersion: (v, d) => real.putConfigVersion(v, d),
        deleteConfigVersion: (v) => real.deleteConfigVersion(v),
        readConfigVersions: async () => {
          if (reads++ > 0) await listing.promise; // the listing inside retain, not the one at open
          return real.readConfigVersions();
        },
      };
      const f = countingFetcher();
      const cv = await openConfigVersions({ store, fetcher: f });
      cv.follow({ deployed: 5, live: [4, 5] });
      await cv.refresh();
      cv.follow({ deployed: 5, live: [5] });
      const retained = cv.retain(none); // memory is dropped, the row listing waits
      while (reads < 2) await Promise.resolve(); // retain reached the row listing
      expect(cv.get(4)).toBe('refetching'); // the queue plans a run against 4: it is wanted again
      listing.open();
      await retained;
      await cv.refresh();
      expect(await stored(real)).toEqual([4, 5]);
      expect(cv.get(4)).not.toBe('refetching');
    });

    it('two retains never overlap', async () => {
      const real = await setup();
      let active = 0;
      let peak = 0;
      const store: ConfigStorePort = {
        putConfigVersion: (v, d) => real.putConfigVersion(v, d),
        deleteConfigVersion: (v) => real.deleteConfigVersion(v),
        readConfigVersions: async () => {
          active++;
          peak = Math.max(peak, active);
          await Promise.resolve();
          const rows = await real.readConfigVersions();
          active--;
          return rows;
        },
      };
      const cv = await openConfigVersions({ store, fetcher: countingFetcher() });
      cv.follow({ deployed: 1, live: [1] });
      await cv.refresh();
      peak = 0;
      await Promise.all([cv.retain(none), cv.retain(none), cv.retain(none)]);
      expect(peak).toBe(1);
    });
  });

  it('property: after retain, exactly (stored ∪ live) ∩ (live ∪ queued) remains, in the store and in memory', async () => {
    const versions = fc.uniqueArray(fc.integer({ min: 1, max: 9 }));
    await fc.assert(
      fc.asyncProperty(versions, versions, versions, async (have, live, queued) => {
        const store = await setup();
        const f = countingFetcher();
        const cv = await openConfigVersions({ store, fetcher: f });
        cv.follow({ deployed: 0, live: have });
        await cv.refresh();
        cv.follow({ deployed: 0, live });
        await cv.refresh();
        await cv.retain(() => Promise.resolve(queued));
        const keep = new Set([...live, ...queued]);
        const expected = [...new Set([...have, ...live])].filter((v) => keep.has(v)).sort((a, b) => a - b);
        expect(await stored(store)).toEqual(expected);
        f.offline = true;
        for (const v of new Set([...have, ...live])) expect(cv.get(v) === 'refetching').toBe(!keep.has(v));
      }),
      { numRuns: 25 },
    );
  });
});
