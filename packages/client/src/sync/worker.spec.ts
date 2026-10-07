import { describe, expect, it, vi } from 'vitest';
import type { SyncResetReason } from '@ueberblick/core/registry';
import { SyncProtocolError } from '@ueberblick/core/sync';
import type { DeviceStore, StoredCursor } from '../store';
import { DeviceStoreError, openDeviceStore } from '../store';
import { fakeEnv, feature, fid, key, memoryMarker, obs, rid, rows, unqueueRuns } from '../store/test-env';
import type { IdbEnv } from '../store';
import { HOST_KINDS, type HostKind } from '../host/kinds';
import { openTestHost } from '../host/test-hosts';
import type { SyncMeta } from './contract';
import { FakeServer, memoryMeta } from './test-server';

async function setupOn(
  kind: HostKind,
  server = new FakeServer(),
  env: IdbEnv = fakeEnv(),
  meta: SyncMeta = memoryMeta(),
) {
  const rederived: SyncResetReason[] = [];
  const host = await openTestHost(kind, { transport: server, env, meta, rederived });
  return { server, host, store: host.store, writer: host.writer, worker: host.sync, env, meta, rederived };
}

const queuedRun = {
  id: rid(1),
  task: key('t'),
  actor: { id: 'a', kind: 'participant', roles: [] },
  configVersion: 1,
  featureId: fid(1),
  input: {},
} as const;

describe.each(HOST_KINDS)('sync worker on the %s host', (kind) => {
  const setup = (server?: FakeServer, env?: IdbEnv, meta?: SyncMeta) => setupOn(kind, server, env, meta);
  const ids = (s: DeviceStore) => s.featureIdsOfType('tree').slice().sort();

  describe('snapshot then delta', () => {
    it('pages a snapshot, switches the cursor to a delta at the pinned head and reports status', async () => {
      const { server, store, worker } = await setup();
      for (let n = 1; n <= 5; n++) server.write(n);
      const r = await worker.pull();
      expect(r.reset).toBe('first_sync');
      expect(ids(store)).toEqual([1, 2, 3, 4, 5].map(fid));
      expect(store.cursor()).toMatchObject({ kind: 'delta', cursor: 5, scopeFingerprint: 'scope-a' });
      expect(worker.status()).toMatchObject({ phase: 'idle', lastSyncedSeq: 5, lastError: undefined });
      server.write(2, { height_m: 99 });
      await worker.pull();
      expect(store.facts.feature(fid(2))?.properties['height_m']).toBe(99);
      expect(store.cursor()?.cursor).toBe(6);
    });

    it('tells the server which choosable set it holds, and applies a changed list even on an empty delta', async () => {
      const { server, store, worker } = await setup();
      server.write(1);
      server.choosable = [
        { id: 'p1', name: 'Anna' },
        { id: 'p2', name: 'Bernd' },
      ];
      await worker.pull();
      expect(server.requests[0]?.choosable ?? '').toBe('');
      expect(store.choosableParticipants().map((p) => p.id)).toEqual(['p1', 'p2']);
      server.requests.length = 0;
      await worker.pull(); // unchanged: the request carries the hash, the answer no list
      expect(server.requests[0]?.choosable).toBe(store.choosableHash());
      expect(store.choosableParticipants()).toHaveLength(2);
      server.choosable = [{ id: 'p1', name: 'Anna' }]; // p2 left; no feature changed
      await worker.pull();
      expect(store.choosableParticipants().map((p) => p.id)).toEqual(['p1']);
      server.choosable = [];
      await worker.pull();
      expect(store.choosableParticipants()).toEqual([]);
    });

    it('an empty delta writes nothing', async () => {
      const { server, writer, worker } = await setup();
      server.write(1);
      await worker.pull();
      const spy = vi.spyOn(writer, 'applyPage');
      await worker.pull();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('crash mid-snapshot', () => {
    it('resumes at the stored cursor and head, and does not refetch applied pages', async () => {
      const server = new FakeServer();
      for (let n = 1; n <= 7; n++) server.write(n);
      const env = fakeEnv();
      const meta = memoryMeta();
      const a = await setup(server, env, meta);
      server.failOn = (n) => (n === 2 ? new Error('network down') : undefined);
      await expect(a.worker.pull()).rejects.toThrow('network down');
      expect(a.store.cursor()).toMatchObject({ kind: 'snapshot', cursor: 4 });
      expect(a.worker.status().lastError).toMatchObject({ kind: 'transport' });
      a.host.dispose();
      // the app restarts: a new store and worker over the same database and meta
      server.failOn = undefined;
      server.requests.length = 0;
      server.write(3, { height_m: 50 }); // written while the device was away
      const b = await setup(server, env, meta);
      expect(b.store.cursor()).toMatchObject({ kind: 'snapshot', cursor: 4 });
      const r = await b.worker.pull();
      expect(r.reset).toBeUndefined();
      expect(server.requests[0]).toMatchObject({ since: 0, after: 4, pin: 7 });
      expect(b.store.cursor()).toMatchObject({ kind: 'delta', cursor: 7 });
      // feature 3 changed after the pin, so it arrives with the next delta
      await b.worker.pull();
      expect(ids(b.store)).toEqual([1, 2, 3, 4, 5, 6, 7].map(fid));
      expect(b.store.facts.feature(fid(3))?.properties['height_m']).toBe(50);
    });

    it('a snapshot cursor without a stored head restarts the snapshot', async () => {
      const server = new FakeServer();
      for (let n = 1; n <= 4; n++) server.write(n);
      const env = fakeEnv();
      const a = await setup(server, env, memoryMeta());
      server.failOn = (n) => (n === 1 ? new Error('x') : undefined);
      await expect(a.worker.pull()).rejects.toThrow();
      a.host.dispose();
      server.failOn = undefined;
      server.requests.length = 0;
      const b = await setup(server, env, memoryMeta()); // meta lost
      await b.worker.pull();
      expect(server.requests[0]).toMatchObject({ since: 0 });
      expect(server.requests[0]?.after).toBeUndefined();
      expect(ids(b.store)).toHaveLength(4);
    });
  });

  describe('writes during a snapshot', () => {
    it('arrive through the delta: no gap, no duplicate', async () => {
      const server = new FakeServer();
      for (let n = 1; n <= 6; n++) server.write(n);
      server.afterPage = (n) => {
        if (n === 0) {
          server.write(1, { height_m: 77 }); // already sent, changes now
          server.write(9); // new feature
          server.remove(6); // not yet sent
        }
      };
      const { store, worker } = await setup(server);
      await worker.pull();
      server.afterPage = undefined;
      await worker.pull();
      expect(ids(store)).toEqual([1, 2, 3, 4, 5, 9].map(fid));
      expect(store.facts.feature(fid(1))?.properties['height_m']).toBe(77);
      expect(store.cursor()?.cursor).toBe(server.seq);
    });
  });

  describe('tombstones', () => {
    it('a tombstone in the same page as its feature, a re-creation, and an unknown feature', async () => {
      const { server, store, worker } = await setup();
      server.write(1);
      server.write(2);
      await worker.pull();
      server.remove(1);
      server.write(3);
      server.remove(3); // created and removed inside one delta
      server.remove(42); // never known to this device
      await worker.pull();
      expect(ids(store)).toEqual([fid(2)]);
      server.write(1, { height_m: 5 }); // re-creation after the tombstone
      await worker.pull();
      expect(ids(store)).toEqual([fid(1), fid(2)]);
      expect(store.facts.feature(fid(1))?.properties['height_m']).toBe(5);
    });
  });

  describe('redaction and blob tombstones', () => {
    it('a redaction applies the blanked row and drops the cached history of that property', async () => {
      const { server, store, writer, worker } = await setup();
      server.write(1, { name: 'Erika' });
      await worker.pull();
      await writer.applyPage(
        rows({ observations: [obs(1, 'name', 1, 'Erika'), obs(1, 'height_m', 2)] }),
        store.cursor() as StoredCursor,
      );
      server.write(1, { name: null });
      server.tombstones.push({ seq: ++server.seq, kind: 'redaction', id: `${fid(1)}#name` });
      await worker.pull();
      expect(store.facts.feature(fid(1))?.properties['name']).toBeNull();
      await store.warmHistory([fid(1)]);
      expect(store.facts.history(fid(1), 'name', 10)).toEqual([]);
      expect(store.facts.history(fid(1), 'height_m', 10)).toHaveLength(1);
    });

    it('a blob tombstone deletes the cached blob of no queued run', async () => {
      const sha = 'cd'.repeat(32);
      const env = fakeEnv();
      const seed = await openDeviceStore('p1-a', { env, marker: memoryMarker() });
      await seed.appendRun(queuedRun, [
        { sha256: sha, bytes: new Uint8Array([1]), mime: 'application/octet-stream' },
      ]);
      seed.close();
      await unqueueRuns(env, 'p1-a');
      const { server, store, worker } = await setup(undefined, env);
      expect(store.blobs.has(sha)).toBe(true);
      server.write(1);
      await worker.pull();
      server.tombstones.push({ seq: ++server.seq, kind: 'blob', id: sha });
      await worker.pull();
      await new Promise((r) => setTimeout(r, 20)); // on the worker host the purge is applied on this thread
      expect(store.blobs.has(sha)).toBe(false);
      expect(await store.getBlob(sha)).toBeUndefined();
    });

    it('a blob tombstone never deletes the blob of a queued run', async () => {
      const sha = 'cd'.repeat(32);
      const { server, store, worker } = await setup();
      await store.appendRun(queuedRun, [
        { sha256: sha, bytes: new Uint8Array([1]), mime: 'application/octet-stream' },
      ]);
      server.write(1);
      await worker.pull();
      server.tombstones.push({ seq: ++server.seq, kind: 'blob', id: sha });
      await worker.pull();
      await new Promise((r) => setTimeout(r, 20));
      expect(store.blobs.has(sha)).toBe(true);
      expect(await store.getBlob(sha)).toEqual(new Uint8Array([1]));
    });

    it('a malformed redaction id is a typed protocol error', async () => {
      const { server, worker } = await setup();
      server.write(1);
      await worker.pull();
      server.tombstones.push({ seq: ++server.seq, kind: 'redaction', id: 'no-hash' });
      await expect(worker.pull()).rejects.toMatchObject({ code: 'malformed' });
    });
  });

  describe('reset', () => {
    it('a changed scope re-snapshots, drops what left the scope and re-derives predictions', async () => {
      const { server, store, worker, rederived } = await setup();
      for (let n = 1; n <= 4; n++) server.write(n);
      await worker.pull();
      const predicted = { ...feature(1, 99), properties: { height_m: 123 } as never };
      await store.putPrediction({ runId: rid(1), features: [predicted], edges: [], observations: [] });
      server.scope = 'scope-b';
      server.features.delete(fid(4)); // no longer visible under the new scope
      const r = await worker.pull();
      expect(r.reset).toBe('scope_changed');
      expect(ids(store)).toEqual([1, 2, 3].map(fid));
      expect(store.cursor()).toMatchObject({ kind: 'delta', scopeFingerprint: 'scope-b' });
      expect(rederived).toEqual(['first_sync', 'scope_changed']);
      expect(store.facts.feature(fid(1))?.properties['height_m']).toBe(123); // prediction intact
    });

    it('a server head behind the cursor re-snapshots', async () => {
      const { server, store, worker } = await setup();
      for (let n = 1; n <= 3; n++) server.write(n);
      await worker.pull();
      server.seq = 1; // the server was restored from an older backup
      server.features.clear();
      server.write(7);
      const r = await worker.pull();
      expect(r.reset).toBe('server_reset');
      expect(ids(store)).toEqual([fid(7)]);
      expect(store.cursor()).toMatchObject({ kind: 'delta', cursor: 2 });
    });
  });

  describe('protocol version', () => {
    it('a mismatch is a typed error, keeps the data and never falls back', async () => {
      const { server, store, worker } = await setup();
      server.write(1);
      await worker.pull();
      server.version = 99;
      server.requests.length = 0;
      const err = await worker.pull().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SyncProtocolError);
      expect((err as SyncProtocolError).code).toBe('version_mismatch');
      expect(server.requests).toHaveLength(1);
      expect(worker.status().lastError).toMatchObject({ kind: 'protocol', code: 'version_mismatch' });
      expect(ids(store)).toEqual([fid(1)]);
    });
  });

  describe('predictions', () => {
    it('a delta arriving while a run is sending does not clobber its prediction', async () => {
      const { server, store, worker } = await setup();
      server.write(1, { height_m: 1 });
      await worker.pull();
      const predicted = { ...feature(1, 1), properties: { height_m: 500 } as never };
      await store.putPrediction({ runId: rid(1), features: [predicted], edges: [], observations: [] });
      server.write(1, { height_m: 2 });
      server.write(2);
      await worker.pull();
      expect(store.facts.feature(fid(1))?.properties['height_m']).toBe(500);
      await store.dropPrediction(rid(1));
      expect(store.facts.feature(fid(1))?.properties['height_m']).toBe(2);
      expect(store.facts.feature(fid(2))).toBeDefined();
    });
  });

  describe('single flight', () => {
    it('a pull during a pull waits, then pulls once more', async () => {
      const { server, worker } = await setup();
      server.write(1);
      const a = worker.pull();
      const b = worker.pull();
      const c = worker.pull();
      await Promise.all([a, b, c]);
      // one snapshot (1 page) plus exactly one rerun delta
      expect(server.requests.map((r) => r.since)).toEqual([0, 1]);
    });

    it('protocol errors from the store surface as a store failure', async () => {
      const { server, writer, worker } = await setup();
      server.write(1);
      vi.spyOn(writer, 'applyPage').mockRejectedValue(new DeviceStoreError('quota_exceeded', 'full'));
      await expect(worker.pull()).rejects.toThrow('full');
      expect(worker.status().lastError).toMatchObject({ kind: 'store', code: 'quota_exceeded' });
    });
  });
});

describe('access value in the pull header (WP-793)', () => {
  it('flags accessChanged once when the value differs from the last pull, not otherwise', async () => {
    const server = new FakeServer();
    const { worker } = await setupOn('in-thread', server);
    server.write(1);
    server.access = 'a1';
    expect((await worker.pull()).accessChanged).toBeFalsy(); // the first value is the baseline
    expect((await worker.pull()).accessChanged).toBeFalsy();
    server.access = 'a2';
    expect((await worker.pull()).accessChanged).toBe(true);
    expect((await worker.pull()).accessChanged).toBeFalsy();
  });
  it('a server without the field never flags it', async () => {
    const server = new FakeServer();
    const { worker } = await setupOn('in-thread', server);
    server.write(1);
    await worker.pull();
    expect((await worker.pull()).accessChanged).toBeFalsy();
  });
  it('reports the last access value seen in the result, so a seeded baseline can be compared (WP-798)', async () => {
    const server = new FakeServer();
    const { worker } = await setupOn('in-thread', server);
    server.write(1);
    server.access = 'a1';
    expect((await worker.pull()).access).toBe('a1');
    server.access = 'a2';
    expect((await worker.pull()).access).toBe('a2');
  });
  it('a result carries no access when the server sent none', async () => {
    const server = new FakeServer();
    const { worker } = await setupOn('in-thread', server);
    server.write(1);
    expect((await worker.pull()).access).toBeUndefined();
  });
});
