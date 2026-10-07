import { describe, expect, it, vi } from 'vitest';
import type { Actor, RunId, Key, Run, Refusal } from '@ueberblick/core/model';
import type { EnqueueResult, QueueStatus, StoredRun } from '@ueberblick/client';
import type { RunProgress } from '@ueberblick/ui';
import { deviceClone } from '../../../../../packages/client/src/testing/clone.testing';
import { createPendingBlobs } from './blobs';
import { createSubmitter, type SubmitterQueue, type SubmitterStore } from './submitter';

const actor: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] };
const id = (n: number) => `r${n}` as RunId;
const status = (over: Partial<QueueStatus> = {}): QueueStatus => ({
  pending: 0,
  awaitingPull: 0,
  oldestPendingAgeMs: undefined,
  sending: undefined,
  refused: [],
  review: [],
  hold: undefined,
  awaitingConfig: [],
  retryInMs: undefined,
  serverProtocol: undefined,
  unpredicted: [],
  ...over,
});

function setup(enqueue?: () => Promise<EnqueueResult>) {
  let rows: StoredRun[] = [];
  const listeners = new Set<(s: QueueStatus) => void>();
  const queue: SubmitterQueue = {
    // like the device store: the run is structured-cloned on the way in (a Proxy or function throws, WP-696/WP-702)
    enqueue: vi.fn(async (run, blobs) => {
      deviceClone(run);
      deviceClone(blobs);
      return (await enqueue?.()) ?? { ok: true as const, orders: [1], created: {} };
    }),
    drain: vi.fn(async () => ({ accepted: 0, refused: 0, review: 0, hold: undefined, busy: false })),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    status: () => status(),
  };
  const store: SubmitterStore = { readRuns: async () => rows };
  const blobs = createPendingBlobs();
  const submitter = createSubmitter({ queue, store, actor, configVersion: 3, blobs, locale: 'en' });
  const setRows = (r: StoredRun[]) => {
    rows = r;
  };
  const emit = (s: QueueStatus = status()) => listeners.forEach((l) => l(s));
  return { queue, submitter, blobs, setRows, emit };
}

const row = (n: number, state: StoredRun['state'], refusal?: Refusal): StoredRun => ({
  order: n,
  run: { id: id(n), task: 't' as Key, actor, configVersion: 3, input: {} } as Run,
  blobs: [],
  blobMimes: {},
  state,
  ...(refusal ? { refusal } : {}),
});
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('submitter', () => {
  it('stores the run with the actor and the config version, then starts sending; it never waits for the server', async () => {
    const t = setup();
    const result = await t.submitter.submit({
      id: id(1),
      task: 'kontrolle' as Key,
      featureId: 'f1' as never,
      input: { befund: 'ok' },
    });
    expect(result).toBe('queued');
    expect(t.queue.enqueue).toHaveBeenCalledWith(
      { id: id(1), task: 'kontrolle', featureId: 'f1', actor, configVersion: 3, input: { befund: 'ok' } },
      [],
    );
    expect(t.queue.drain).toHaveBeenCalledTimes(1);
  });

  it('hands the store plain data: a reactive proxy in the input (a $state value) would fail the IndexedDB clone (WP-696)', async () => {
    // the fake queue clones like IndexedDB, so a Proxy that reached it would reject here (WP-702)
    const t = setup();
    const point = new Proxy({ type: 'Point', coordinates: [10, 50] }, {});
    expect(() => structuredClone(point)).toThrow();
    await expect(
      t.submitter.submit({ id: id(1), task: 'melden' as Key, input: { geometrie: point as never } }),
    ).resolves.toBe('queued');
  });

  it('a store that throws is logged with its cause and the error goes on to the caller', async () => {
    const cause = new Error('boom');
    const t = setup(async () => {
      throw cause;
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(t.submitter.submit({ id: id(1), task: 't' as Key, input: {} })).rejects.toBe(cause);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('could not be stored'), cause);
    log.mockRestore();
  });

  it('attaches the bytes of the files a tool produced, by their sha256', async () => {
    const t = setup();
    const sha = 'a'.repeat(64);
    await t.blobs.put(sha, new Blob([new Uint8Array([1, 2, 3])]), 'image/jpeg');
    await t.submitter.submit({
      id: id(1),
      task: 'kontrolle' as Key,
      input: { foto: [{ sha256: sha, name: 'x.jpg', mime: 'image/jpeg' }] },
    });
    const call = vi.mocked(t.queue.enqueue).mock.calls[0];
    expect(call?.[1]?.map((b) => [b.sha256, [...b.bytes]])).toEqual([[sha, [1, 2, 3]]]);
  });

  it('follows the run: queued, then accepted, and accepted still when a pull already removed it', async () => {
    const t = setup();
    await t.submitter.submit({ id: id(1), task: 't' as Key, input: {} });
    const seen: RunProgress[] = [];
    t.setRows([row(1, 'queued')]);
    t.submitter.outcome(id(1), (p) => seen.push(p));
    await settle();
    t.setRows([row(1, 'accepted')]);
    t.emit();
    await settle();
    t.setRows([]);
    t.emit();
    await settle();
    expect(seen.map((p) => p.state)).toEqual(['queued', 'accepted']);
  });

  it('a refusal from the server or from the device shows its typed reason', async () => {
    const refusal = { code: 'not_available', message: 'Nicht verfügbar' } as Refusal;
    const t = setup();
    await t.submitter.submit({ id: id(1), task: 't' as Key, input: {} });
    t.setRows([row(1, 'refused', refusal)]);
    const seen: RunProgress[] = [];
    t.submitter.outcome(id(1), (p) => seen.push(p));
    await settle();
    expect(seen.at(-1)).toEqual({
      state: 'refused',
      reason: "This task is not available in the entry's current state.",
    });
  });

  it('a run that the device itself refuses is stored as a refused draft and reported as refused', async () => {
    const refusal = { code: 'constraint', message: 'Befund muss sich ändern' } as Refusal;
    const t = setup(async () => ({ ok: false, runId: id(2), refusal }));
    await t.submitter.submit({ id: id(2), task: 't' as Key, input: {} });
    t.setRows([row(2, 'refused', refusal)]);
    const seen: RunProgress[] = [];
    t.submitter.outcome(id(2), (p) => seen.push(p));
    await settle();
    expect(seen.at(-1)).toMatchObject({ state: 'refused' });
  });

  it('stops listening when unsubscribed', async () => {
    const t = setup();
    await t.submitter.submit({ id: id(1), task: 't' as Key, input: {} });
    t.setRows([row(1, 'queued')]);
    const seen: RunProgress[] = [];
    const off = t.submitter.outcome(id(1), (p) => seen.push(p));
    await settle();
    off();
    t.setRows([row(1, 'accepted')]);
    t.emit();
    await settle();
    expect(seen.map((p) => p.state)).toEqual(['queued']);
  });
});
