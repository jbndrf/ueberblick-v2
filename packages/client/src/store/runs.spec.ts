// WP-511 (store side): atomic batches, run states, removal. Runs are the irreplaceable data.
import { describe, expect, it, vi } from 'vitest';
import type { Run } from '@ueberblick/core/model';
import { openDeviceStore } from './open';
import { fakeEnv, memoryMarker, rid, wrapStore } from './test-env';

const run = (n: number): Run => ({
  id: rid(n),
  task: 't' as Run['task'],
  actor: { id: 'a', kind: 'participant', roles: [] },
  configVersion: 1,
  input: { n },
});

const open = () => openDeviceStore('r', { env: fakeEnv(), marker: memoryMarker() });

describe('run rows', () => {
  it('appendRuns stores a whole batch and its blobs in one transaction, with a group', async () => {
    const store = await open();
    const bytes = new Uint8Array([1, 2, 3]);
    const orders = await store.appendRuns(
      [{ run: run(1), blobs: [{ sha256: 'aa', bytes, mime: 'application/octet-stream' }] }, { run: run(2) }],
      {
        group: 'g1',
      },
    );
    expect(orders[1]).toBeGreaterThan(orders[0] ?? 0);
    const rows = await store.readRuns();
    expect(rows.map((r) => [r.run.id, r.state, r.group])).toEqual([
      [rid(1), 'queued', 'g1'],
      [rid(2), 'queued', 'g1'],
    ]);
    expect(store.blobs.has('aa')).toBe(true);
    expect(rows[0]?.blobMimes).toEqual({ aa: 'application/octet-stream' });
    expect(rows[1]?.blobMimes).toEqual({});
  });

  it('a quota error stores nothing of the batch', async () => {
    const store = await open();
    let n = 0;
    wrapStore('add', (next, self) => {
      if (self.name === 'runs' && ++n === 2) {
        const e = new Error('full');
        e.name = 'QuotaExceededError';
        throw e;
      }
      return next();
    });
    await expect(store.appendRuns([{ run: run(1) }, { run: run(2) }], { group: 'g' })).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
    vi.restoreAllMocks();
    expect(await store.readRuns()).toEqual([]);
  });

  it('a repeated run id keeps its order and row', async () => {
    const store = await open();
    const [a] = await store.appendRuns([{ run: run(1) }]);
    const [b] = await store.appendRuns([{ run: run(1) }]);
    expect(b).toBe(a);
    expect(await store.readRuns()).toHaveLength(1);
  });

  it('settleRuns changes state, refusal and accepted seq; removeRuns removes rows only', async () => {
    const store = await open();
    await store.appendRuns([{ run: run(1) }, { run: run(2) }, { run: run(3) }]);
    await store.settleRuns([
      { runId: rid(1), state: 'accepted', acceptedSeq: 7 },
      { runId: rid(2), state: 'refused', refusal: { code: 'not_permitted', message: 'm' } },
      { runId: rid(99), state: 'refused' },
    ]);
    const rows = await store.readRuns();
    expect(rows[0]).toMatchObject({ state: 'accepted', acceptedSeq: 7 });
    expect(rows[1]).toMatchObject({ state: 'refused', refusal: { code: 'not_permitted' } });
    expect(rows[1]?.run.input).toEqual({ n: 2 });
    expect(rows[2]?.state).toBe('queued');
    await store.removeRuns([rid(1), rid(2)]);
    expect((await store.readRuns()).map((r) => r.run.id)).toEqual([rid(3)]);
  });

  it('a row written by appendRun reads as queued', async () => {
    const store = await open();
    await store.appendRun(run(1));
    expect((await store.readRuns())[0]?.state).toBe('queued');
  });

  it('a settled run survives clearCache', async () => {
    const store = await open();
    await store.appendRuns([{ run: run(1) }]);
    await store.settleRuns([{ runId: rid(1), state: 'refused', refusal: { code: 'x', message: 'm' } }]);
    await store.clearCache();
    expect(await store.readRuns()).toHaveLength(1);
  });
});
