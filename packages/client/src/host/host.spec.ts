import { describe, expect, it, vi } from 'vitest';
import type { SyncResetReason } from '@ueberblick/core/registry';
import { DeviceStoreError, openDeviceStore } from '../store';
import type { StoreChange } from '../store';
import { edge, fakeEnv, feature, fid, key, memoryMarker, rid, rows, unqueueRuns } from '../store/test-env';
import { sliceNotice, type CommitNotice } from '../store/commit';
import { FakeServer, memoryMeta } from '../sync/test-server';
import { HOST_PROTOCOL_VERSION as v, HostProtocolError } from './protocol';
import { openWorkerHost } from './proxy';
import { HOST_KINDS, SINGLE_TAB, type HostKind } from './kinds';
import { openTestHost } from './test-hosts';

async function open(kind: HostKind, server = new FakeServer(), onFault?: (e: Error) => void) {
  const rederived: SyncResetReason[] = [];
  const env = fakeEnv();
  const host = await openTestHost(kind, {
    transport: server,
    env,
    meta: memoryMeta(),
    rederived,
    ...(onFault ? { onFault } : {}),
  });
  const changes: StoreChange[] = [];
  host.store.onChange((c) => changes.push(c));
  return { host, server, env, changes, rederived };
}

describe.each(HOST_KINDS)('change notifications on the %s host', (kind) => {
  it('one page notice per applied page, with the changed ids, and reads see the page inside the listener', async () => {
    const server = new FakeServer();
    server.pageSize = 2;
    for (let n = 1; n <= 5; n++) server.write(n);
    const { host } = await open(kind, server);
    const seen: { ids: string[]; readable: boolean; cursor: number }[] = [];
    host.store.onChange((c) => {
      if (c.kind !== 'page') return;
      seen.push({
        ids: [...c.featureIds],
        readable: c.featureIds.every((id) => host.store.facts.feature(id) !== undefined),
        cursor: c.cursor.cursor,
      });
    });
    await host.sync.pull();
    expect(seen.map((s) => s.ids)).toEqual([[fid(1), fid(2)], [fid(3), fid(4)], [fid(5)]]);
    expect(seen.every((s) => s.readable)).toBe(true);
    expect(seen.map((s) => s.cursor)).toEqual([2, 4, 5]);
    server.remove(2);
    await host.sync.pull();
    const last = seen.at(-1);
    expect(last?.ids).toEqual([fid(2)]);
    expect(host.store.facts.feature(fid(2))).toBeUndefined();
  });

  it('a page bigger than one slice is still exactly one notice, with every changed id', async () => {
    const server = new FakeServer();
    server.pageSize = 2000;
    for (let n = 1; n <= 1500; n++) server.write(n);
    const { host, changes } = await open(kind, server);
    await host.sync.pull();
    const pages = changes.filter((c) => c.kind === 'page');
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ kind: 'page', cursor: { cursor: 1500 } });
    expect(pages[0]).toMatchObject({ featureIds: expect.arrayContaining([fid(1), fid(1500)]) });
    expect(pages[0]).toHaveProperty('featureIds.length', 1500);
    expect(host.store.featureIdsOfType('tree')).toHaveLength(1500);
    expect(host.store.cursor()).toMatchObject({ cursor: 1500 });
  });

  it('a reset is a cleared notice, a purge a history_dropped notice', async () => {
    const server = new FakeServer();
    server.write(1);
    const { host, changes } = await open(kind, server);
    await host.sync.pull();
    server.scope = 'scope-b';
    await host.sync.pull();
    expect(changes.map((c) => c.kind)).toEqual(['page', 'cleared', 'page']);
    await host.writer.dropHistory(fid(1), ['h']);
    await new Promise((r) => setTimeout(r, 20)); // the notice crosses the port
    expect(changes.at(-1)).toMatchObject({ kind: 'history_dropped', featureId: fid(1) });
  });

  it('status changes reach the main thread', async () => {
    const server = new FakeServer();
    server.write(1);
    const { host } = await open(kind, server);
    const phases: string[] = [];
    host.sync.subscribe((s) => phases.push(s.phase));
    await host.sync.pull();
    expect(phases).toContain('snapshot');
    expect(host.sync.status()).toMatchObject({ phase: 'idle', lastSyncedSeq: 1, featuresLoaded: 1 });
  });
});

describe('the worker host', () => {
  it('the replica refuses cache writes: the worker is the only writer', async () => {
    const { host } = await open('worker');
    const refused = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 'not_writer' });
    await refused(host.store.applyPage(rows({}), { kind: 'delta', cursor: 1, scopeFingerprint: 's' }));
    await refused(host.store.clearCache());
    await refused(host.store.dropHistory(fid(1), ['h']));
  });

  it('the run queue is asked to re-derive on the main thread after a reset', async () => {
    const server = new FakeServer();
    server.write(1);
    const { host, rederived } = await open('worker', server);
    await expect(host.sync.pull()).resolves.toMatchObject({ reset: 'first_sync' });
    server.scope = 'scope-b';
    await host.sync.pull();
    expect(rederived).toEqual(['first_sync', 'scope_changed']);
  });

  it('the worker announces a blob purge and never writes blobs; main applies it and skips a queued run blob', async () => {
    const env = fakeEnv();
    const seed = await openDeviceStore('p1-a', { env, marker: memoryMarker() });
    const run = {
      id: rid(1),
      task: key('t'),
      actor: { id: 'a', kind: 'participant', roles: [] },
      configVersion: 1,
      featureId: fid(1),
      input: {},
    } as const;
    await seed.appendRun(run, [
      { sha256: 'aa', bytes: new Uint8Array([1]), mime: 'application/octet-stream' },
    ]);
    await unqueueRuns(env, 'p1-a'); // 'aa' is settled: no run references it
    await seed.appendRun({ ...run, id: rid(2) }, [
      { sha256: 'bb', bytes: new Uint8Array([2]), mime: 'application/octet-stream' },
    ]);
    seed.close();
    const rederived: SyncResetReason[] = [];
    const host = await openTestHost('worker', {
      transport: new FakeServer(),
      env,
      meta: memoryMeta(),
      rederived,
    });
    const announced: CommitNotice[] = [];
    host.writer.onCommit((n) => announced.push(n));
    const changes: StoreChange[] = [];
    host.store.onChange((c) => changes.push(c));
    await host.writer.deleteBlob('aa');
    await host.writer.deleteBlob('bb');
    expect(announced.map((n) => n.commit)).toEqual([
      { kind: 'blob_purge', ids: ['aa'] },
      { kind: 'blob_purge', ids: ['bb'] },
    ]);
    await new Promise((r) => setTimeout(r, 30));
    expect(host.store.blobs.has('aa')).toBe(false);
    expect(await host.store.getBlob('aa')).toBeUndefined();
    expect(await host.store.getBlob('bb')).toEqual(new Uint8Array([2]));
    expect(changes).toEqual([{ kind: 'blob_deleted', sha256: 'aa' }]);
  });

  it('the worker store never writes the run queue; a removed run frees its blob for a purge', async () => {
    const { host } = await open('worker');
    const run = {
      id: rid(3),
      task: key('t'),
      actor: { id: 'a', kind: 'participant', roles: [] },
      configVersion: 1,
      featureId: fid(1),
      input: {},
    } as const;
    const refused = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 'not_writer' });
    await refused(host.writer.appendRuns([{ run }]));
    await refused(host.writer.settleRuns([]));
    await refused(host.writer.removeRuns([run.id]));
    await host.store.appendRuns([
      { run, blobs: [{ sha256: 'cc', bytes: new Uint8Array([3]), mime: 'application/octet-stream' }] },
    ]);
    await host.store.deleteBlob('cc');
    expect(host.store.blobs.has('cc')).toBe(true); // queued: kept
    await host.store.removeRuns([run.id]);
    await host.store.deleteBlob('cc');
    expect(host.store.blobs.has('cc')).toBe(false);
  });

  it('dispose rejects a pending pull and closes the replica', async () => {
    const server = new FakeServer();
    server.write(1);
    const { host } = await open('worker', server);
    const pending = host.sync.pull();
    host.dispose();
    await expect(pending).rejects.toThrow('disposed');
    expect(host.store.state).toBe('unavailable');
    await expect(host.sync.pull()).rejects.toThrow('disposed');
  });
});

describe('the worker host over a hand-driven port', () => {
  /** The test plays the worker: it answers `init` with `ready` and can send anything after. */
  async function driven(faults: Error[]) {
    const env = fakeEnv();
    const { port1, port2 } = new MessageChannel();
    const got: { kind: string; id?: number }[] = [];
    port1.onmessage = (e) => {
      const m = e.data as { kind: string; id?: number };
      got.push(m);
      if (m.kind === 'init') port1.postMessage({ v, kind: 'ready', cursor: undefined });
    };
    const host = await openWorkerHost({
      name: 'p1-a',
      options: { env, marker: memoryMarker() },
      port: port2 as never,
      config: {},
      tabs: SINGLE_TAB,
      predictions: { rederive: () => Promise.reject(new DeviceStoreError('aborted', 'queue busy')) },
      onFault: (e) => faults.push(e),
    });
    const settle = () => new Promise((r) => setTimeout(r, 20));
    return { host, env, port1, got, settle };
  }

  it('a notice that does not start at the replica cursor raises replica_diverged and re-reads the database', async () => {
    const faults: Error[] = [];
    const { host, env, port1, settle } = await driven(faults);
    expect(host.store.featureIdsOfType('tree')).toEqual([]);
    // another connection (another tab) writes; this replica was not told
    const other = await openDeviceStore('p1-a', { env, marker: memoryMarker() });
    await other.applyPage(rows({ features: [feature(1, 1)] }), {
      kind: 'delta',
      cursor: 1,
      scopeFingerprint: 's',
    });
    const changes: StoreChange[] = [];
    host.store.onChange((c) => changes.push(c));
    port1.postMessage({
      v,
      kind: 'change',
      notice: { from: { kind: 'delta', cursor: 99, scopeFingerprint: 'x' }, commit: { kind: 'cleared' } },
    });
    await settle();
    expect(faults[0]).toBeInstanceOf(HostProtocolError);
    expect(faults[0]).toMatchObject({ code: 'replica_diverged' });
    expect(changes).toEqual([{ kind: 'reloaded' }]);
    expect(host.store.featureIdsOfType('tree')).toEqual([fid(1)]);
    expect(host.store.cursor()).toMatchObject({ cursor: 1 });
    port1.close();
  });

  it('a slice that is not the next one raises replica_diverged and re-reads', async () => {
    const faults: Error[] = [];
    const { host, port1, settle } = await driven(faults);
    const plan = {
      featurePuts: [],
      featureDeletes: [],
      edgePuts: [],
      edgeDeletes: [],
      historyPuts: [],
      runPuts: [],
      peoplePuts: [],
    };
    const cursor = { kind: 'delta', cursor: 1, scopeFingerprint: 's' };
    const changes: StoreChange[] = [];
    host.store.onChange((c) => changes.push(c));
    const page = (index: number) => ({
      v,
      kind: 'change',
      notice: { from: undefined, part: { index, count: 3 }, commit: { kind: 'page', plan, cursor } },
    });
    port1.postMessage(page(0));
    port1.postMessage(page(2)); // slice 1 is missing
    await settle();
    expect(faults[0]).toMatchObject({ code: 'replica_diverged' });
    expect(changes).toEqual([{ kind: 'reloaded' }]); // no page notice for a half page
    port1.close();
  });

  it('a refused message faults the host and rejects a pending pull; nothing is applied', async () => {
    const faults: Error[] = [];
    const { host, port1, settle } = await driven(faults);
    const pending = expect(host.sync.pull()).rejects.toMatchObject({ code: 'unknown_kind' });
    port1.postMessage({ v, kind: 'levitate' });
    await settle();
    await pending;
    expect(faults[0]).toMatchObject({ code: 'unknown_kind' });
    port1.close();
  });

  it('a failing rederive is answered with a typed error, not swallowed', async () => {
    const { port1, got, settle } = await driven([]);
    port1.postMessage({ v, kind: 'rederive', id: 5, reason: 'first_sync' });
    await settle();
    expect(got.find((m) => m.kind === 'rederived')).toMatchObject({
      id: 5,
      error: { kind: 'store', code: 'aborted' },
    });
    port1.close();
  });

  it('the worker sends init then start, in that order, before any pull', async () => {
    const { host, got, settle } = await driven([]);
    await settle();
    expect(got.map((m) => m.kind)).toEqual(['init', 'start']);
    host.dispose();
  });

  /** A page of `n` features each with one edge and one history row, sliced at `cap` rows. */
  function slicedPage(n: number, cap: number, from: unknown = undefined): CommitNotice[] {
    const cursor = { kind: 'delta', cursor: 7, scopeFingerprint: 's' } as const;
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    const notice = {
      from,
      commit: {
        kind: 'page',
        cursor,
        plan: {
          featurePuts: ids.map((k) => feature(k, 1)),
          featureDeletes: [],
          edgePuts: ids.map((k) => edge(k, 'near', k + 1, 1)),
          edgeDeletes: [],
          historyPuts: [],
          runPuts: [],
          peoplePuts: [],
        },
      },
    } as CommitNotice;
    return [...sliceNotice(notice, cap)];
  }

  it('a reader between slices never sees a feature without its edges', async () => {
    const { host, port1, settle } = await driven([]);
    const slices = slicedPage(30, 12); // 6 features per slice
    expect(slices.length).toBeGreaterThan(3);
    const changes: StoreChange[] = [];
    host.store.onChange((c) => changes.push(c));
    for (const slice of slices.slice(0, -1)) {
      port1.postMessage({ v, kind: 'change', notice: slice });
      await settle();
      expect(host.store.pageInFlight()).toBe(true);
      for (const id of host.store.featureIdsOfType('tree'))
        expect(host.store.facts.edgesFrom(id)).toHaveLength(1);
      expect(changes).toEqual([]); // no notice before the page is whole
    }
    port1.postMessage({ v, kind: 'change', notice: slices.at(-1) });
    await settle();
    expect(host.store.pageInFlight()).toBe(false);
    expect(host.store.featureIdsOfType('tree')).toHaveLength(30);
    expect(changes).toHaveLength(1);
    port1.close();
  });

  it('between slices an edge may dangle (its target arrives later) and resolves after the last slice', async () => {
    const { host, port1, settle } = await driven([]);
    const slices = slicedPage(30, 12); // feature k has an edge to k + 1
    port1.postMessage({ v, kind: 'change', notice: slices[0] });
    await settle();
    expect(host.store.pageInFlight()).toBe(true);
    const ids = host.store.featureIdsOfType('tree');
    const dangling = ids
      .flatMap((id) => host.store.facts.edgesFrom(id))
      .filter((e) => host.store.facts.feature(e.to) === undefined);
    expect(dangling).toHaveLength(1); // the last feature of slice 0 points into slice 1
    expect(host.store.facts.edgesTo(dangling[0]?.to as never)).toHaveLength(1);
    for (const slice of slices.slice(1)) port1.postMessage({ v, kind: 'change', notice: slice });
    await settle();
    expect(host.store.pageInFlight()).toBe(false);
    expect(host.store.facts.feature(dangling[0]?.to as never)).toBeDefined();
    port1.close();
  });

  it('after a divergence the rest of the page is discarded and the replica re-reads once', async () => {
    const faults: Error[] = [];
    const { host, port1, settle } = await driven(faults);
    const stale = { kind: 'delta', cursor: 99, scopeFingerprint: 'x' };
    const slices = slicedPage(30, 12, stale);
    const changes: StoreChange[] = [];
    host.store.onChange((c) => changes.push(c));
    for (const slice of slices) port1.postMessage({ v, kind: 'change', notice: slice });
    // Wait for the outcome, not a fixed 20 ms: 30 slices did not fit into settle() on a loaded machine (2026-10-03).
    const quiet = { timeout: 5000, interval: 10 };
    await vi.waitFor(() => {
      expect(changes.filter((c) => c.kind === 'reloaded')).toHaveLength(1);
      expect(host.store.pageInFlight()).toBe(false);
    }, quiet);
    await settle();
    expect(faults).toHaveLength(1);
    expect(changes.filter((c) => c.kind === 'reloaded')).toHaveLength(1);
    expect(changes.filter((c) => c.kind === 'page')).toHaveLength(0);
    expect(host.store.pageInFlight()).toBe(false);
    // the next page is applied normally again (it continues from the re-read cursor: none)
    for (const slice of slicedPage(2, 12)) port1.postMessage({ v, kind: 'change', notice: slice });
    await vi.waitFor(() => expect(changes.filter((c) => c.kind === 'page')).toHaveLength(1), quiet);
    expect(faults).toHaveLength(1);
    port1.close();
  });
});
