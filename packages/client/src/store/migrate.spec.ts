import { describe, expect, it } from 'vitest';
import type { CompiledConfigData } from '@ueberblick/core/hydrate';
import type { Run } from '@ueberblick/core/model';
import { DB_VERSION, MIGRATIONS } from './schema';
import { openDeviceStore } from './open';
import { fakeEnv, fid, key, memoryMarker, newFactory, rid } from './test-env';
import type { FakeFactory } from './test-env';

const run = (n: number): Run => ({
  id: rid(n),
  task: key('kontrolle'),
  actor: { id: 'p1', kind: 'participant', roles: [key('feld')] },
  configVersion: 3,
  featureId: fid(1),
  input: { note: 'x' },
});

const data = (format: number): CompiledConfigData => ({
  format,
  file: {} as CompiledConfigData['file'],
  hash: 'h',
  expressions: [],
});

/** Builds a database exactly as the v1 app left it: v1 layout, one queued run, one blob, one prediction. */
async function fixtureV1(factory: FakeFactory): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = factory.open('p1-project-a', 1);
    req.onupgradeneeded = () => {
      const tx = req.transaction;
      if (!tx) return;
      // the v1 layout, written out by hand: it must not follow later edits of MIGRATIONS
      const db = req.result;
      db.createObjectStore('features', { keyPath: 'id' });
      db.createObjectStore('edges', { keyPath: 'key' });
      db.createObjectStore('history', { keyPath: ['featureId', 'property', 'seq'] });
      db.createObjectStore('runs', { keyPath: 'order', autoIncrement: true }).createIndex('runId', 'runId', {
        unique: true,
      });
      db.createObjectStore('blobs', { keyPath: 'sha256' });
      db.createObjectStore('predictions', { keyPath: 'runId' });
      db.createObjectStore('meta');
      tx.objectStore('runs').add({ runId: run(1).id, run: run(1), blobs: ['abc'] });
      tx.objectStore('blobs').put({ sha256: 'abc', bytes: new Uint8Array([1, 2, 3]) });
      tx.objectStore('predictions').put({ runId: run(1).id, features: [], edges: [] });
      tx.objectStore('meta').put({ kind: 'delta', cursor: 4, scopeFingerprint: 's' }, 'cursor');
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

describe('schema versions', () => {
  it('has an ascending migration list whose last step is the DB version', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual(versions.map((_, i) => i + 1));
    expect(DB_VERSION).toBe(versions.length);
    expect(DB_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('opens a v1 database, migrates it and keeps runs, blobs, predictions and the cursor', async () => {
    const factory = newFactory();
    await fixtureV1(factory);
    const marker = memoryMarker(true);
    const store = await openDeviceStore('p1-project-a', { env: fakeEnv(factory), marker });
    expect(store.origin).toBe('existing');
    expect((await store.readRuns()).map((r) => r.run.id)).toEqual([rid(1)]);
    expect((await store.readRuns())[0]?.blobs).toEqual(['abc']);
    expect(await store.getBlob('abc')).toEqual(new Uint8Array([1, 2, 3]));
    expect(store.blobs.has('abc')).toBe(true);
    expect(store.cursor()?.cursor).toBe(4);
    // the new store exists and works
    expect(await store.readConfigVersions()).toEqual([]);
    await store.putConfigVersion(3, data(1));
    expect((await store.readConfigVersions()).map((c) => c.version)).toEqual([3]);
  });

  it('keeps config versions across clearCache and reopen', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await openDeviceStore('x', { env, marker });
    await a.putConfigVersion(2, data(1));
    await a.clearCache();
    a.close();
    const b = await openDeviceStore('x', { env, marker });
    expect((await b.readConfigVersions())[0]?.data.format).toBe(1);
  });
});
