import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '@ueberblick/core/model';
import { DeviceStoreError } from './codes';
import type { DeviceStore, StoreIssue } from './contract';
import type { IdbDatabase, IdbEnv, IdbFactory, IdbOpenRequest } from './idb-types';
import { openDeviceStore } from './open';
import {
  cursorAt,
  edge,
  fakeEnv,
  feature,
  fid,
  key,
  memoryMarker,
  newFactory,
  obs,
  plainEdge,
  rid,
  rows,
  wrapStore,
  type FakeFactory,
} from './test-env';

afterEach(() => vi.restoreAllMocks());

const run = (n: number): Run => ({
  id: rid(n),
  task: key('kontrolle'),
  actor: { id: 'p1', kind: 'participant', roles: [key('feld')] },
  configVersion: 3,
  featureId: fid(1),
  input: { note: 'x' },
});

async function open(env: IdbEnv = fakeEnv(), marker = memoryMarker(), onIssue?: (i: StoreIssue) => void) {
  return openDeviceStore('p1-project-a', { env, marker, ...(onIssue ? { onIssue } : {}) });
}

describe('open and persistence', () => {
  it('opens fresh, marks the device initialised and persists pages across reopen', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await open(env, marker);
    expect(a.origin).toBe('fresh');
    expect(marker.value).toBe(true);
    const f = feature(1, 5);
    await a.applyPage(
      rows({ features: [f], edges: [edge(1, 'parent', 2, 5)], observations: [obs(1, 'height_m', 5)] }),
      cursorAt(5),
    );
    a.close();
    const b = await open(env, marker);
    expect(b.origin).toBe('existing');
    expect(b.facts.feature(fid(1))).toEqual(f);
    expect(b.facts.edgesFrom(fid(1))).toEqual([plainEdge(edge(1, 'parent', 2, 5))]);
    expect(b.facts.edgesTo(fid(2), key('parent'))).toHaveLength(1);
    expect(b.cursor()).toEqual(cursorAt(5));
    expect(b.featureIdsOfType('tree')).toEqual([fid(1)]);
  });

  it('keeps Z coordinates unchanged (H1)', async () => {
    const a = await open();
    await a.applyPage(rows({ features: [feature(3, 1)] }), cursorAt(1));
    expect(a.facts.feature(fid(3))?.properties['geometry']).toEqual({
      type: 'Point',
      coordinates: [13 + 3 / 1e4, 52, 33],
    });
  });
});

describe('history', () => {
  it('caps history at the last 10 per (feature, property), newest first', async () => {
    const a = await open();
    const first = Array.from({ length: 8 }, (_, i) => obs(1, 'height_m', i + 1));
    const second = Array.from({ length: 8 }, (_, i) => obs(1, 'height_m', i + 9));
    await a.applyPage(rows({ features: [feature(1, 1)], observations: first }), cursorAt(8));
    await a.applyPage(rows({ observations: second }), cursorAt(16, 'delta'));
    await a.warmHistory([fid(1)]);
    const h = a.facts.history(fid(1), 'height_m', 100);
    expect(h.map((o) => o.seq)).toEqual([16, 15, 14, 13, 12, 11, 10, 9, 8, 7]);
    expect(a.facts.history(fid(1), 'height_m', 3).map((o) => o.seq)).toEqual([16, 15, 14]);
    a.close();
  });

  it('throws history_not_warm instead of answering empty for a cold feature', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await open(env, marker);
    await a.applyPage(rows({ features: [feature(1, 1)], observations: [obs(1, 'p', 1)] }), cursorAt(1));
    a.close();
    const b = await open(env, marker);
    expect(() => b.facts.history(fid(1), 'p', 5)).toThrowError(/history_not_warm|not loaded/);
    await b.warmHistory([fid(1)]);
    expect(b.facts.history(fid(1), 'p', 5)).toHaveLength(1);
  });
});

describe('atomic pages and stale guard', () => {
  it('an abort mid-page leaves the old cursor and no partial rows', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await open(env, marker);
    await a.applyPage(rows({ features: [feature(1, 1)] }), cursorAt(1));
    let calls = 0;
    wrapStore('put', (next) => {
      if (++calls === 4) throw new Error('boom');
      return next();
    });
    const page = rows({ features: [feature(2, 2), feature(3, 3), feature(4, 4), feature(5, 5)] });
    await expect(a.applyPage(page, cursorAt(9))).rejects.toBeInstanceOf(DeviceStoreError);
    vi.restoreAllMocks();
    expect(a.cursor()).toEqual(cursorAt(1));
    expect(a.facts.feature(fid(2))).toBeUndefined();
    a.close();
    const b = await open(env, marker);
    expect(b.cursor()).toEqual(cursorAt(1));
    expect([2, 3, 4, 5].map((n) => b.facts.feature(fid(n)))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(b.facts.feature(fid(1))).toBeDefined();
  });

  it('a row with a lower updatedSeq never overwrites a newer one', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await open(env, marker);
    await a.applyPage(
      rows({ features: [feature(1, 10, { v: 'new' })], edges: [edge(1, 'r', 2, 10)] }),
      cursorAt(10),
    );
    const out = await a.applyPage(
      rows({ features: [feature(1, 4, { v: 'old' })], edges: [{ ...edge(1, 'r', 2, 4), derived: true }] }),
      cursorAt(11, 'delta'),
    );
    expect(out.staleSkipped).toBe(2);
    expect(a.facts.feature(fid(1))?.properties['v']).toBe('new');
    expect(a.facts.edgesFrom(fid(1))[0]?.derived).toBe(false);
    a.close();
    const b = await open(env, marker);
    expect(b.facts.feature(fid(1))?.properties['v']).toBe('new');
  });

  it('tombstones remove features and edges unless re-created later', async () => {
    const a = await open();
    await a.applyPage(
      rows({
        features: [feature(1, 2), feature(2, 9)],
        edges: [edge(1, 'r', 2, 2)],
        tombstones: [
          { seq: 5, kind: 'feature', id: fid(1) },
          { seq: 5, kind: 'feature', id: fid(2) },
        ],
      }),
      cursorAt(9),
    );
    expect(a.facts.feature(fid(1))).toBeUndefined();
    expect(a.facts.feature(fid(2))).toBeDefined();
    expect(a.facts.edgesFrom(fid(1))).toEqual([]);
    expect(a.facts.edgesTo(fid(2))).toEqual([]);
  });
});

describe('failure modes never delete the database', () => {
  function spyingEnv(): {
    env: IdbEnv;
    del: ReturnType<typeof vi.fn>;
    dbs: IdbDatabase[];
    real: FakeFactory;
  } {
    const real = newFactory();
    const del = vi.fn();
    const dbs: IdbDatabase[] = [];
    const wrapper = {
      open(name: string, version?: number): IdbOpenRequest {
        const req = (real as unknown as IdbFactory).open(name, version);
        const prev = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(req), 'onsuccess');
        void prev;
        return new Proxy(req, {
          set(target, prop, value) {
            if (prop === 'onsuccess') {
              (target as unknown as Record<string, unknown>)[prop] = (ev: unknown) => {
                dbs.push(target.result);
                (value as (e: unknown) => void)(ev);
              };
              return true;
            }
            (target as unknown as Record<string, unknown>)[prop as string] = value;
            return true;
          },
        });
      },
      deleteDatabase: del,
    };
    return { env: { ...fakeEnv(real), factory: wrapper as unknown as IdbFactory }, del, dbs, real };
  }

  it('an open failure is a typed error and deletes nothing', async () => {
    const del = vi.fn();
    const factory = {
      open() {
        throw new Error('SecurityError');
      },
      deleteDatabase: del,
    } as unknown as IdbFactory;
    await expect(open({ ...fakeEnv(), factory })).rejects.toMatchObject({ code: 'open_failed' });
    expect(del).not.toHaveBeenCalled();
  });

  it('blocked surfaces an issue, keeps waiting, never deletes', async () => {
    const real = newFactory();
    const del = vi.fn();
    const factory = {
      open(name: string, version?: number): IdbOpenRequest {
        const req = (real as unknown as IdbFactory).open(name, version);
        queueMicrotask(() => req.onblocked?.({}));
        return req;
      },
      deleteDatabase: del,
    } as unknown as IdbFactory;
    const issues: StoreIssue[] = [];
    const store = await open({ ...fakeEnv(real), factory }, memoryMarker(), (i) => issues.push(i));
    expect(issues.map((i) => i.code)).toEqual(['blocked']);
    expect(store.state).toBe('open');
    expect(del).not.toHaveBeenCalled();
  });

  it('terminated makes the store unavailable but runs stay readable for export', async () => {
    const { env, del, dbs } = spyingEnv();
    const issues: StoreIssue[] = [];
    const store = await open(env, memoryMarker(), (i) => issues.push(i));
    await store.appendRun(run(1));
    dbs[0]?.onclose?.({});
    expect(issues.map((i) => i.code)).toEqual(['terminated']);
    expect(store.state).toBe('unavailable');
    await expect(store.applyPage(rows({}), cursorAt(1))).rejects.toMatchObject({ code: 'unavailable' });
    expect((await store.exportRuns()).map((r) => r.run.id)).toEqual([rid(1)]);
    expect(del).not.toHaveBeenCalled();
  });

  it('versionchange closes the connection for the other tab and reports it', async () => {
    const { env, dbs } = spyingEnv();
    const issues: StoreIssue[] = [];
    const store = await open(env, memoryMarker(), (i) => issues.push(i));
    dbs[0]?.onversionchange?.({});
    expect(issues.map((i) => i.code)).toEqual(['version_change']);
    expect(store.state).toBe('unavailable');
  });
});

describe('clear cache and eviction guard', () => {
  it('clearCache drops features, edges, history and cursor, never runs, blobs or predictions', async () => {
    const a = await open();
    await a.applyPage(
      rows({ features: [feature(1, 1)], edges: [edge(1, 'r', 2, 1)], observations: [obs(1, 'p', 1)] }),
      cursorAt(1),
    );
    await a.appendRun(run(1), [
      { sha256: 'abc', bytes: new Uint8Array([1, 2, 3]), mime: 'application/octet-stream' },
    ]);
    await a.putPrediction({ runId: rid(1), features: [feature(1, 2)], edges: [], observations: [] });
    await a.clearCache();
    expect(a.facts.feature(fid(1))?.updatedSeq).toBe(2); // only the prediction remains
    await a.dropPrediction(rid(2));
    expect(a.cursor()).toBeUndefined();
    expect(a.facts.edgesFrom(fid(1))).toEqual([]);
    await a.warmHistory([fid(1)]);
    expect(a.facts.history(fid(1), 'p', 5)).toEqual([]);
    expect((await a.readRuns()).map((r) => r.run.id)).toEqual([rid(1)]);
    expect(a.blobs.has('abc')).toBe(true);
    expect(await a.getBlob('abc')).toEqual(new Uint8Array([1, 2, 3]));
    await a.dropPrediction(rid(1));
    expect(a.facts.feature(fid(1))).toBeUndefined();
  });

  it('an empty database with the initialised marker set reports evicted', async () => {
    const marker = memoryMarker(true);
    const env = fakeEnv();
    const a = await open(env, marker);
    expect(a.origin).toBe('evicted');
    a.close();
    const b = await open(env, marker);
    expect(b.origin).toBe('evicted'); // stays until acknowledged
    await b.acknowledgeEviction();
    b.close();
    const c = await open(env, marker);
    expect(c.origin).toBe('existing');
  });
});

describe('runs, blobs, predictions', () => {
  it('appendRun is idempotent per run id and orders by a device counter', async () => {
    const a = await open();
    const o1 = await a.appendRun(run(1));
    const o2 = await a.appendRun(run(2));
    expect(await a.appendRun(run(1))).toBe(o1);
    expect(o2).toBeGreaterThan(o1);
    expect((await a.readRuns()).map((r) => r.run.id)).toEqual([rid(1), rid(2)]);
  });

  it('a quota error rejects loudly and queues no half run', async () => {
    const a = await open();
    const full = () => {
      throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    };
    wrapStore('put', full);
    wrapStore('add', full);
    await expect(
      a.appendRun(run(1), [{ sha256: 'zz', bytes: new Uint8Array(4), mime: 'application/octet-stream' }]),
    ).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
    vi.restoreAllMocks();
    expect(await a.readRuns()).toEqual([]);
    expect(a.blobs.has('zz')).toBe(false);
  });

  it('predictions overlay server state and survive a reopen', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await open(env, marker);
    await a.applyPage(rows({ features: [feature(1, 1, { v: 'server' })] }), cursorAt(1));
    await a.putPrediction({
      runId: rid(7),
      features: [feature(1, 1, { v: 'predicted' })],
      edges: [],
      observations: [],
    });
    expect(a.facts.feature(fid(1))?.properties['v']).toBe('predicted');
    a.close();
    const b = await open(env, marker);
    expect(b.facts.feature(fid(1))?.properties['v']).toBe('predicted');
    await b.dropPrediction(rid(7));
    expect(b.facts.feature(fid(1))?.properties['v']).toBe('server');
  });
});

describe('index-only lookups', () => {
  it('after open, no operation scans a whole store', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const seed = await open(env, marker);
    await seed.applyPage(
      rows({
        features: [feature(1, 1), feature(2, 2)],
        observations: Array.from({ length: 12 }, (_, i) => obs(1, 'p', i + 1)),
      }),
      cursorAt(2),
    );
    seed.close();
    const store: DeviceStore = await open(env, marker);
    const unbounded: string[] = [];
    for (const m of ['openCursor', 'getAll', 'getAllKeys', 'count'] as const) {
      wrapStore(m, (next, self, args) => {
        if (args[0] === undefined || args[0] === null) unbounded.push(`${self.name}.${m}`);
        return next();
      });
    }
    await store.warmHistory([fid(1), fid(2)]);
    await store.applyPage(
      rows({ features: [feature(3, 3)], observations: [obs(1, 'p', 20), obs(3, 'p', 3)] }),
      cursorAt(3, 'delta'),
    );
    await store.appendRun(run(1));
    await store.putPrediction({ runId: rid(1), features: [feature(1, 9)], edges: [], observations: [] });
    store.facts.feature(fid(1));
    store.facts.edgesFrom(fid(1));
    store.facts.history(fid(1), 'p', 10);
    expect(unbounded).toEqual([]);
  });
});
