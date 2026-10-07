/**
 * Simulation (WP-669): a deploy pins features while a device is offline with queued runs. On reconnect the
 * device has the pinned version, keeps the version a queued run still names, and the queue drains.
 */
import { describe, expect, it } from 'vitest';
import type { Instant } from '@ueberblick/core/model';
import { countingFetcher } from '../config/retain.testing';
import { versionsSink } from '../config/sink';
import { openConfigVersions } from '../config/versions';
import { befundErgaenzen, IDS, makeKit } from '../queue/queue.testing';
import { createSyncWorker } from '../sync';
import type { SyncTransport } from '../sync';
import { FakeServer, memoryMeta } from '../sync/test-server';

describe('a deploy that pins features while a device is offline with queued runs', () => {
  it('fetches the pinned version on reconnect, keeps the one a queued run names, and the queue drains', async () => {
    const holder: { get: (v: number) => ReturnType<Awaited<ReturnType<typeof openConfigVersions>>['get']> } =
      {
        get: () => 'refetching',
      };
    const k = await makeKit({ config: (v) => holder.get(v) });
    const fetcher = countingFetcher();
    const config = await openConfigVersions({ store: k.store, fetcher });
    holder.get = (v) => config.get(v);

    const server = new FakeServer();
    server.write(1);
    server.write(2);
    const net = { online: true, versions: { deployed: 2, live: [1, 2] as readonly number[] } };
    const transport: SyncTransport = {
      fetchPage: async (r) => {
        if (!net.online) throw new Error('offline');
        const p = await server.fetchPage(r);
        return { ...p, header: { ...p.header, versions: net.versions } };
      },
    };
    const worker = createSyncWorker({
      store: k.store,
      transport,
      meta: memoryMeta(),
      predictions: k.queue,
      clock: { now: () => '2026-09-29T10:00:00Z' as Instant },
      config: versionsSink({ versions: config, store: k.store }),
    });
    const stored = async () => (await k.store.readConfigVersions()).map((r) => r.version);

    // online: both live versions arrive
    await worker.pull();
    await config.refresh();
    expect(await stored()).toEqual([1, 2]);

    // offline: runs queue under version 1 (a feature still pinned there) and under 3 (not on the device yet)
    net.online = false;
    const pinned = befundErgaenzen(1, IDS.linde, 'A');
    const ahead = { ...befundErgaenzen(2, IDS.linde, 'B'), configVersion: 3 };
    await k.store.appendRuns([{ run: pinned }, { run: ahead }]);
    // version 1 is on the device: the head is sent; 3 is not: that run waits, nothing is lost
    expect(await k.queue.drain()).toMatchObject({ accepted: 1, hold: 'awaiting_config' });
    expect(k.queue.status().awaitingConfig).toEqual([3]);

    // the deploy pins features: live is now [2, 3]. Reconnect: the pull follows the header
    net.online = true;
    net.versions = { deployed: 3, live: [2, 3] };
    server.write(3);
    await worker.pull();
    await config.refresh();
    expect(config.deployed).toBe(3);
    expect(await stored()).toContain(3);
    expect(await stored()).toContain(1); // the accepted run still waits for its pull: kept until it is gone

    k.queue.resetBackoff();
    expect(await k.queue.drain()).toMatchObject({ hold: undefined });
    await k.queue.onPulled(1_000);
    expect(await k.store.readRuns()).toEqual([]);

    // the next completed sync drops 1: neither live nor queued
    server.write(4);
    await worker.pull();
    expect((await stored()).sort()).toEqual([2, 3]);
  });
});
