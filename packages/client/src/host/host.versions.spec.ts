/** Both hosts feed the same sink: a header with new live versions reaches `follow`, a completed pull prunes (WP-669). */
import { describe, expect, it } from 'vitest';
import type { SyncResetReason } from '@ueberblick/core/registry';
import type { SyncVersions } from '@ueberblick/core/sync';
import { countingFetcher } from '../config/retain.testing';
import { versionsSink } from '../config/sink';
import { openConfigVersions } from '../config/versions';
import { openDeviceStore } from '../store/open';
import { fakeEnv, fid, key, memoryMarker, rid } from '../store/test-env';
import type { SyncTransport } from '../sync/contract';
import { FakeServer, memoryMeta } from '../sync/test-server';
import { HOST_KINDS, SINGLE_TAB } from './kinds';
import { HOST_PROTOCOL_VERSION, HostProtocolError } from './protocol';
import { openWorkerHost, type WorkerPortLike } from './proxy';
import { openTestHost } from './test-hosts';

const queuedAt = (n: number, configVersion: number) => ({
  id: rid(n),
  task: key('t'),
  actor: { id: 'a', kind: 'participant' as const, roles: [] },
  configVersion,
  featureId: fid(1),
  input: {},
});

describe.each(HOST_KINDS)('config versions through the %s host', (kind) => {
  async function setup(first: SyncVersions) {
    const server = new FakeServer();
    server.write(1);
    const header = { current: first };
    const transport: SyncTransport = {
      fetchPage: async (r) => {
        const p = await server.fetchPage(r);
        return { ...p, header: { ...p.header, versions: header.current } };
      },
    };
    const env = fakeEnv();
    // the main thread's own connection: where ConfigVersions and the queue live
    const mainStore = await openDeviceStore('p1-a', { env, marker: memoryMarker() });
    const versions = await openConfigVersions({ store: mainStore, fetcher: countingFetcher() });
    const followed: SyncVersions[] = [];
    const watch: { onSynced: (done: Promise<void>) => void } = { onSynced: () => undefined };
    const sink = versionsSink({ versions, store: mainStore });
    const host = await openTestHost(kind, {
      transport,
      env,
      meta: memoryMeta(),
      rederived: [] as SyncResetReason[],
      versions: {
        follow: (v) => (followed.push(v), sink.follow(v)),
        synced: (v) => {
          const done = sink.synced(v);
          watch.onSynced(done);
          return done;
        },
      },
    });
    const stored = async () => (await mainStore.readConfigVersions()).map((r) => r.version);
    /** Resolves when the next completed pull has been applied by the sink (no timers). */
    const nextSynced = () =>
      new Promise<void>((resolve) => (watch.onSynced = (done) => void done.then(resolve)));
    return { host, header, versions, followed, stored, mainStore, nextSynced };
  }

  it('a header with new live versions reaches follow and the versions are fetched', async () => {
    const k = await setup({ deployed: 2, live: [1, 2] });
    await k.host.sync.pull();
    await k.versions.refresh();
    expect(k.followed.at(-1)).toEqual({ deployed: 2, live: [1, 2] });
    expect(k.versions.deployed).toBe(2);
    expect((await k.stored()).sort()).toEqual([1, 2]);
  });

  it('a completed pull prunes exactly what is neither live nor queued', async () => {
    const k = await setup({ deployed: 3, live: [1, 2, 3] });
    await k.mainStore.appendRun(queuedAt(1, 2));
    const first = k.nextSynced();
    await k.host.sync.pull();
    await first;
    await k.versions.refresh();
    expect((await k.stored()).sort()).toEqual([1, 2, 3]);
    k.header.current = { deployed: 3, live: [3] };
    const second = k.nextSynced();
    await k.host.sync.pull();
    await second; // the worker host's message crosses a channel
    expect((await k.stored()).sort()).toEqual([2, 3]);
  });
});

describe('a host that speaks another protocol', () => {
  it('is a host fault: the pending pull is rejected and onFault tells the app (never only a log line)', async () => {
    const port: WorkerPortLike = {
      postMessage: (m) => {
        if ((m as { kind: string }).kind === 'init')
          queueMicrotask(() => port.onmessage?.({ data: { v: HOST_PROTOCOL_VERSION, kind: 'ready' } }));
      },
      onmessage: null,
    };
    const faults: Error[] = [];
    const host = await openWorkerHost({
      name: 'p1-a',
      options: { env: fakeEnv(), marker: memoryMarker() },
      port,
      config: {},
      predictions: { rederive: () => Promise.resolve() },
      tabs: SINGLE_TAB,
      onFault: (e) => faults.push(e),
    });
    const rejected = expect(host.sync.pull()).rejects.toMatchObject({ code: 'bad_version' });
    // an older tab's worker (protocol 1) answers
    port.onmessage?.({ data: { v: HOST_PROTOCOL_VERSION - 1, kind: 'status', status: {} } });
    await rejected;
    expect(faults[0]).toBeInstanceOf(HostProtocolError);
    host.dispose();
  });
});
