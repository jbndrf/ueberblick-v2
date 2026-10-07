import { describe, expect, it } from 'vitest';
import type { Run } from '@ueberblick/core/model';
import { openDeviceStore } from './open';
import { cursorAt, fakeEnv, feature, fid, key, memoryMarker, obs, rid, rows, unqueueRuns } from './test-env';

const run = (n: number): Run => ({
  id: rid(n),
  task: key('kontrolle'),
  actor: { id: 'p1', kind: 'participant', roles: [key('feld')] },
  configVersion: 3,
  featureId: fid(1),
  input: { note: 'x' },
});

describe('purges (GDPR tombstones)', () => {
  it('deleteBlob drops bytes and key, also after reopen, and is idempotent', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await openDeviceStore('p', { env, marker });
    await a.appendRun(run(1), [
      { sha256: 'abc', bytes: new Uint8Array([1]), mime: 'application/octet-stream' },
      { sha256: 'def', bytes: new Uint8Array([2]), mime: 'application/octet-stream' },
    ]);
    a.close();
    await unqueueRuns(env, 'p'); // settled: the bytes stay, no queued run references them
    const b = await openDeviceStore('p', { env, marker });
    await b.deleteBlob('abc');
    await b.deleteBlob('abc');
    expect(b.blobs.has('abc')).toBe(false);
    expect(b.blobs.has('def')).toBe(true);
    expect(await b.getBlob('abc')).toBeUndefined();
    b.close();
    const c = await openDeviceStore('p', { env, marker });
    expect(c.blobs.has('abc')).toBe(false);
    expect(await c.getBlob('def')).toEqual(new Uint8Array([2]));
  });

  it('a blob a queued run still references survives a purge; an unreferenced one does not', async () => {
    const env = fakeEnv();
    const a = await openDeviceStore('p', { env, marker: memoryMarker() });
    await a.appendRun(run(1), [
      { sha256: 'abc', bytes: new Uint8Array([1]), mime: 'application/octet-stream' },
    ]);
    await a.appendRun(run(2), [
      { sha256: 'def', bytes: new Uint8Array([2]), mime: 'application/octet-stream' },
    ]);
    a.close();
    const b = await openDeviceStore('p', { env, marker: memoryMarker() });
    const changes: string[] = [];
    b.onChange((c) => changes.push(c.kind));
    await b.deleteBlob('abc');
    expect(await b.getBlob('abc')).toEqual(new Uint8Array([1]));
    expect(b.blobs.has('abc')).toBe(true);
    expect(changes).toEqual([]);
  });

  it('dropHistory removes only the listed properties of one feature, warm or stored', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await openDeviceStore('p', { env, marker });
    await a.applyPage(
      rows({
        features: [feature(1, 5), feature(2, 5)],
        observations: [obs(1, 'name', 1), obs(1, 'name', 2), obs(1, 'height_m', 3), obs(2, 'name', 4)],
      }),
      cursorAt(5),
    );
    await a.warmHistory([fid(1), fid(2)]);
    await a.dropHistory(fid(1), ['name']);
    expect(a.facts.history(fid(1), 'name', 10)).toEqual([]);
    expect(a.facts.history(fid(1), 'height_m', 10)).toHaveLength(1);
    expect(a.facts.history(fid(2), 'name', 10)).toHaveLength(1);
    a.close();
    const b = await openDeviceStore('p', { env, marker });
    await b.warmHistory([fid(1), fid(2)]);
    expect(b.facts.history(fid(1), 'name', 10)).toEqual([]);
    expect(b.facts.history(fid(1), 'height_m', 10)).toHaveLength(1);
    expect(b.facts.history(fid(2), 'name', 10)).toHaveLength(1);
  });

  it('the page plan does not treat redaction and blob tombstones as feature tombstones', async () => {
    const a = await openDeviceStore('p', { env: fakeEnv(), marker: memoryMarker() });
    await a.applyPage(rows({ features: [feature(1, 5)] }), cursorAt(5));
    await a.applyPage(
      rows({
        tombstones: [
          { seq: 9, kind: 'redaction', id: fid(1) },
          { seq: 9, kind: 'blob', id: fid(1) },
        ],
      }),
      cursorAt(9),
    );
    expect(a.facts.feature(fid(1))).toBeDefined();
  });
});
