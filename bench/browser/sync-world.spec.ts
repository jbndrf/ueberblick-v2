// Tests of the sync-snapshot-60k fixture (WP-560): the snapshot pages a server would send and the pull
// through the real device store and sync worker. The browser run itself is `npm run bench:browser`.
import { describe, expect, it } from 'vitest';
import type { Instant } from '../../packages/core/src/model';
import { openDeviceStore } from '../../packages/client/src/store/open';
import { fakeEnv, memoryMarker } from '../../packages/client/src/store/test-env';
import { createSyncWorker } from '../../packages/client/src/sync/worker';
import { memoryMeta } from '../../packages/client/src/sync/test-server';
import { PAGE_FEATURES, SCOPE, snapshotServer, snapshotPage } from './lib/sync-world';

describe('sync-snapshot fixture', () => {
  it('a page holds 1,000 features with observations and edges, and ids are unique across pages', () => {
    const a = snapshotPage(0, 3);
    const b = snapshotPage(1, 3);
    expect(a.features).toHaveLength(PAGE_FEATURES);
    expect(a.observations.length).toBeGreaterThan(0);
    expect(a.edges).toHaveLength(PAGE_FEATURES);
    expect(new Set([...a.features, ...b.features].map((f) => f.id)).size).toBe(2 * PAGE_FEATURES);
    expect(a.header.more).toBe(true);
    expect(b.header.more).toBe(true);
    expect(snapshotPage(2, 3).header.more).toBe(false);
  });

  it('the server pages by keyset and pins the head', async () => {
    const server = snapshotServer(3);
    const p0 = await server.fetchPage({ since: 0, scope: '', v: 1 });
    const p1 = await server.fetchPage({
      since: 0,
      scope: SCOPE,
      v: 1,
      after: p0.header.cursor,
      pin: p0.header.head,
    });
    expect(p1.features[0]?.id).not.toBe(p0.features[0]?.id);
    expect(p1.header.head).toBe(p0.header.head);
    expect(server.pagesServed()).toBe(2);
  });

  it('pulls all pages through the real store and sync worker', async () => {
    const store = await openDeviceStore('w', { env: fakeEnv(), marker: memoryMarker() });
    const worker = createSyncWorker({
      store,
      transport: snapshotServer(3),
      meta: memoryMeta(),
      predictions: { rederive: () => Promise.resolve() },
      clock: { now: () => '2026-09-30T00:00:00Z' as Instant },
    });
    const r = await worker.pull();
    expect(r.pages).toBe(3);
    expect(store.featureIdsOfType('tree')).toHaveLength(3 * PAGE_FEATURES);
  });

  it('calls the hook before each page (the scenario blocks the thread there in self-test)', async () => {
    const seen: number[] = [];
    const server = snapshotServer(3, (n) => seen.push(n));
    await server.fetchPage({ since: 0, scope: '', v: 1 });
    expect(seen).toEqual([0]);
  });
});
