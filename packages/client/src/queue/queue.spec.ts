// WP-511: the run queue. One test per acceptance box (rebase and prediction: rebase.spec.ts).
import { describe, expect, it, vi } from 'vitest';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { FeatureId } from '@ueberblick/core/model';
import { openDeviceStore } from '../store/open';
import { fakeEnv, memoryMarker, wrapStore } from '../store/test-env';
import { createRunQueue } from './queue';
import {
  FakeRunServer,
  IDS,
  befundErgaenzen,
  kontrolle,
  makeKit,
  memoryLock,
  refusal,
  runId,
} from './queue.testing';

const T: FeatureId = IDS.t_in;

describe('submit', () => {
  it('a batch is one queue entry and one request; a refusal refuses every run of it', async () => {
    const k = await makeKit();
    const batch = [befundErgaenzen(1, T, 'A'), befundErgaenzen(2, T, 'B'), befundErgaenzen(3, T, 'C')];
    expect(await k.queue.submit(batch)).toMatchObject({ ok: true });
    const rows = await k.store.readRuns();
    expect(new Set(rows.map((r) => r.group)).size).toBe(1);
    expect(rows.map((r) => r.state)).toEqual(['queued', 'queued', 'queued']);
    expect(k.queue.status().pending).toBe(3);

    k.server.script = { refuse: (run) => (run.id === runId(2) ? refusal('constraint_failed') : undefined) };
    const res = await k.queue.drain();
    expect(k.server.sent).toHaveLength(1);
    expect(k.server.sent[0]?.kind).toBe('batch');
    expect(res).toMatchObject({ refused: 3, accepted: 0 });
    const status = k.queue.status();
    expect(status.pending).toBe(0);
    expect(status.refused.map((r) => r.runId)).toEqual([runId(1), runId(2), runId(3)]);
    expect(status.refused.every((r) => r.refusal.code === 'constraint_failed')).toBe(true);
    expect(k.server.applied.size).toBe(0);
  });

  it('an accepted batch settles every run and keeps predictions until a pull reached its seq', async () => {
    const k = await makeKit();
    await k.queue.submit([befundErgaenzen(1, T, 'A'), befundErgaenzen(2, T, 'B')]);
    await k.queue.drain();
    expect(k.queue.status()).toMatchObject({ pending: 0, awaitingPull: 2 });
    expect(k.store.facts.feature(T)?.properties['befund']).toBe('B');
    await k.queue.onPulled(1);
    expect(k.queue.status().awaitingPull).toBe(1);
    await k.queue.onPulled(2);
    expect(k.queue.status().awaitingPull).toBe(0);
    expect(await k.store.readRuns()).toEqual([]);
    expect(k.store.facts.feature(T)?.properties['befund']).toBe('unauffällig');
  });

  it('rejects a malformed batch loudly: empty, duplicate ids, mixed config versions', async () => {
    const k = await makeKit();
    await expect(k.queue.submit([])).rejects.toMatchObject({ code: 'invalid_batch' });
    await expect(
      k.queue.submit([befundErgaenzen(1, T, 'A'), befundErgaenzen(1, T, 'B')]),
    ).rejects.toMatchObject({ code: 'invalid_batch' });
    await expect(
      k.queue.submit([befundErgaenzen(1, T, 'A'), { ...befundErgaenzen(2, T, 'B'), configVersion: 2 }]),
    ).rejects.toMatchObject({ code: 'invalid_batch' });
    expect(await k.store.readRuns()).toEqual([]);
  });

  it('a device refusal stores the whole batch as refused drafts and predicts nothing', async () => {
    const k = await makeKit();
    const bad = kontrolle(2, T, 'A'); // constraint: value != self.befund, and run 1 predicts befund A
    const res = await k.queue.submit([befundErgaenzen(1, T, 'A'), bad]);
    expect(res).toMatchObject({ ok: false, runId: bad.id, refusal: { code: 'constraint_failed' } });
    expect((await k.store.readRuns()).map((r) => r.state)).toEqual(['refused', 'refused']);
    expect(k.store.facts.feature(T)?.properties['befund']).toBe('unauffällig');
    expect(k.queue.status().refused).toHaveLength(2);
    expect(k.server.sent).toHaveLength(0);
  });
});

describe('refusal codes end to end', () => {
  it('the code from the server reaches the status unchanged; nothing derives from a status', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    k.server.script = { refuse: () => refusal('not_permitted', 'nope') };
    await k.queue.drain();
    expect(k.queue.status().refused[0]).toMatchObject({
      runId: runId(1),
      refusal: { code: 'not_permitted', message: 'nope' },
      input: { befund: 'A' },
    });
  });
});

describe('order and sequence', () => {
  it('the order is the enqueue order, whatever the device clock does', async () => {
    const k = await makeKit();
    k.clock.set('2030-01-01T00:00:00.000Z');
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    k.clock.set('2001-01-01T00:00:00.000Z'); // the clock jumps back
    await k.queue.enqueue(befundErgaenzen(2, T, 'B'));
    k.clock.set('2040-01-01T00:00:00.000Z');
    await k.queue.enqueue(befundErgaenzen(3, T, 'C'));
    await k.queue.drain();
    const ids = k.server.sent.map((p) => (p.kind === 'run' ? p.run.id : ''));
    expect(ids).toEqual([runId(1), runId(2), runId(3)]);
    expect(k.queue.status().oldestPendingAgeMs).toBeUndefined();
  });

  it('is strictly sequential: run n+1 is never sent before run n is settled', async () => {
    const k = await makeKit();
    for (let n = 1; n <= 4; n++) await k.queue.enqueue(befundErgaenzen(n, T, `v${n}`));
    await k.queue.drain();
    expect(k.server.maxInFlight).toBe(1);
    expect(k.server.sent).toHaveLength(4);
  });

  it('a second drain call in the same tab joins the running one and sends nothing twice', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    const [a, b] = await Promise.all([k.queue.drain(), k.queue.drain()]);
    expect(k.server.sent).toHaveLength(1);
    expect(a).toEqual(b);
  });

  it('reports the head run as sending while a request is in flight', async () => {
    const k = await makeKit();
    let release: () => void = () => undefined;
    k.server.gate = new Promise((r) => (release = r));
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    const done = k.queue.drain();
    await vi.waitFor(() => expect(k.queue.status().sending).toBe(runId(1)));
    release();
    await done;
    expect(k.queue.status().sending).toBeUndefined();
  });
});

describe('crash and replay', () => {
  it('a crash after store and before send re-sends after a restart', async () => {
    const env = fakeEnv();
    const server = new FakeRunServer();
    const first = await makeKit({ env, server });
    await first.queue.enqueue(befundErgaenzen(1, T, 'A'));
    first.store.close(); // "crash": nothing was sent
    expect(server.sent).toHaveLength(0);
    const store = await openDeviceStore('q', { env, marker: memoryMarker(true) });
    const second = await makeKit({ env, server, store });
    expect(second.queue.status().pending).toBe(1);
    await second.queue.drain();
    expect(server.applied.get(runId(1))).toBe(1);
  });

  it('a crash while sending re-sends; the ledger replays, so observations are applied once', async () => {
    const env = fakeEnv();
    const server = new FakeRunServer();
    const first = await makeKit({ env, server });
    await first.queue.enqueue(befundErgaenzen(1, T, 'A'));
    await first.queue.enqueue(befundErgaenzen(2, T, 'B'));
    // the server judged run 1 but the answer never arrived, then the app died
    server.next = () => new Promise(() => undefined);
    void first.queue.drain();
    await vi.waitFor(() => expect(server.sent).toHaveLength(1));
    const wire = server.sent[0];
    if (wire?.kind !== 'run') throw new Error('expected a single run');
    server.judge(wire.run);
    server.next = undefined;
    first.store.close();
    const store = await openDeviceStore('q', { env, marker: memoryMarker(true) });
    const second = await makeKit({ env, server, store });
    expect(second.queue.status().pending).toBe(2);
    await second.queue.drain();
    expect(server.applied.get(runId(1))).toBe(1);
    expect(server.applied.get(runId(2))).toBe(1);
    expect(server.sent.filter((p) => p.kind === 'run' && p.run.id === runId(1))).toHaveLength(2);
  });
});

describe('typed refusal versus transient failure', () => {
  it.each([
    ['a thrown network error', () => Promise.reject(new Error('offline'))],
    [
      'a transient reply (5xx, unknown 404, timeout)',
      () => Promise.resolve({ kind: 'transient' as const, reason: '503' }),
    ],
  ])('%s never refuses; the run stays queued with a backoff', async (_n, next) => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    k.server.next = next;
    const res = await k.queue.drain();
    expect(res).toMatchObject({ refused: 0, accepted: 0, hold: 'backoff' });
    const s = k.queue.status();
    expect(s).toMatchObject({ pending: 1, hold: 'backoff', refused: [] });
    expect(s.retryInMs).toBe(2_000);
  });

  it('a hung request times out and counts as transient', async () => {
    const k = await makeKit({ sendTimeoutMs: 5_000 });
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    k.server.next = () => new Promise(() => undefined);
    const done = k.queue.drain();
    await vi.waitFor(() => expect(k.timers.pending.length).toBeGreaterThan(0));
    expect(k.timers.pending[0]?.ms).toBe(5_000);
    k.timers.fire();
    expect(await done).toMatchObject({ hold: 'backoff' });
    expect(k.queue.status().pending).toBe(1);
  });

  it('backs off exponentially up to a cap; nothing is sent inside the window; online resets it', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    k.server.next = () => Promise.reject(new Error('offline'));
    const delays: (number | undefined)[] = [];
    for (let i = 0; i < 12; i++) {
      await k.queue.drain();
      delays.push(k.queue.status().retryInMs);
      k.mono.t += k.queue.status().retryInMs ?? 0;
    }
    expect(delays.slice(0, 4)).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(Math.max(...(delays as number[]))).toBe(300_000);
    const sentBefore = k.server.sent.length;
    await k.queue.drain(); // the last window has elapsed: one more failed attempt
    expect(k.server.sent.length).toBe(sentBefore + 1);
    await k.queue.drain(); // inside the new window: no request
    expect(k.server.sent.length).toBe(sentBefore + 1);
    k.queue.resetBackoff();
    k.server.next = undefined;
    expect(await k.queue.drain()).toMatchObject({ accepted: 1 });
  });

  it('only a typed refusal refuses: after transient failures the run is judged normally', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    k.server.next = () => Promise.resolve({ kind: 'transient', reason: '404 from a proxy' });
    await k.queue.drain();
    k.queue.resetBackoff();
    k.server.next = undefined;
    k.server.script = { refuse: () => refusal('required_missing') };
    await k.queue.drain();
    expect(k.queue.status().refused[0]?.refusal.code).toBe('required_missing');
  });
});

describe('auth and config', () => {
  it('auth expiry pauses the queue without losing a run; sign-in resumes it', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    await k.queue.enqueue(befundErgaenzen(2, T, 'B'));
    k.server.next = () => Promise.resolve({ kind: 'unauthenticated' });
    const res = await k.queue.drain();
    expect(res.hold).toBe('auth_expired');
    expect(k.queue.status()).toMatchObject({ pending: 2, hold: 'auth_expired', refused: [] });
    expect((await k.store.readRuns()).map((r) => r.state)).toEqual(['queued', 'queued']);
    k.server.next = undefined;
    k.queue.resetBackoff();
    expect(await k.queue.drain()).toMatchObject({ accepted: 2, hold: undefined });
    expect(k.queue.status().hold).toBeUndefined();
  });

  it('a run whose config version is gone on the server goes to review, never dropped', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    k.server.next = () =>
      Promise.resolve({
        kind: 'response',
        response: { outcome: 'review', runId: runId(1), reason: 'config_version_gone', configVersion: 1 },
      });
    const res = await k.queue.drain();
    expect(res.review).toBe(1);
    expect(k.queue.status()).toMatchObject({ pending: 0, review: [{ runId: runId(1), configVersion: 1 }] });
    const rows = await k.store.readRuns();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'review' });
    expect(k.store.facts.feature(T)?.properties['befund']).toBe('unauffällig'); // no prediction
  });

  it("waits while the device is still fetching the head run's config version", async () => {
    const holder: { config: CompiledConfig | 'refetching' } = { config: 'refetching' };
    const k = await makeKit({ config: () => holder.config });
    // a run recorded against version 1 before an app update: the store holds it, the version is refetching
    await k.store.appendRuns([{ run: befundErgaenzen(1, T, 'A') }]);
    const q = await createRunQueue(k.deps);
    const res = await q.drain();
    expect(res.hold).toBe('awaiting_config');
    expect(q.status()).toMatchObject({ pending: 1, hold: 'awaiting_config', awaitingConfig: [1] });
    expect(k.server.sent).toHaveLength(0);
    holder.config = k.config;
    expect(await q.drain()).toMatchObject({ accepted: 1 });
  });
});

describe('two tabs', () => {
  it('single-flight through the lock: no double send, the second tab reports busy', async () => {
    const env = fakeEnv();
    const server = new FakeRunServer();
    const lock = memoryLock();
    const a = await makeKit({ env, server, lock });
    const b = await makeKit({ env, server, lock, store: a.store });
    await a.queue.enqueue(befundErgaenzen(1, T, 'A'));
    await a.queue.enqueue(befundErgaenzen(2, T, 'B'));
    let release: () => void = () => undefined;
    server.gate = new Promise((r) => (release = r));
    const first = a.queue.drain();
    await vi.waitFor(() => expect(server.inFlight).toBe(1));
    const second = await b.queue.drain();
    expect(second).toMatchObject({ busy: true, accepted: 0 });
    release();
    await first;
    expect(server.sent).toHaveLength(2);
    expect([...server.applied.values()]).toEqual([1, 1]);
  });
});

describe('quota', () => {
  it('quota exceeded on enqueue rejects loudly and stores no half run or batch', async () => {
    const k = await makeKit();
    wrapStore('add', (next, self) => {
      if (self.name === 'runs') {
        const e = new Error('full');
        e.name = 'QuotaExceededError';
        throw e;
      }
      return next();
    });
    await expect(
      k.queue.submit([befundErgaenzen(1, T, 'A'), befundErgaenzen(2, T, 'B')]),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    vi.restoreAllMocks();
    expect(await k.store.readRuns()).toEqual([]);
    expect(k.store.facts.feature(T)?.properties['befund']).toBe('unauffällig');
    expect(k.queue.status().pending).toBe(0);
  });
});

describe('drafts and export', () => {
  it('a refused draft can be exported, resubmitted under a new id, or discarded', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    k.server.script = { refuse: () => refusal('not_available') };
    await k.queue.drain();
    const json = JSON.parse(await k.queue.exportQueue()) as {
      runs: { state: string; run: { id: string } }[];
    };
    expect(json.runs).toMatchObject([{ state: 'refused', run: { id: runId(1) } }]);

    k.server.script = {};
    const res = await k.queue.resubmit(runId(1));
    expect(res.ok).toBe(true);
    const rows = await k.store.readRuns();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.run.id).not.toBe(runId(1));
    expect(rows[0]?.run.input).toEqual({ befund: 'A' });
    await k.queue.drain();
    expect(k.queue.status().awaitingPull).toBe(1);

    await k.queue.enqueue(befundErgaenzen(9, T, 'Z'));
    k.server.script = { refuse: () => refusal('not_available') };
    await k.queue.drain();
    await k.queue.discard(runId(9));
    expect((await k.store.readRuns()).map((r) => r.run.id)).not.toContain(runId(9));
    await expect(k.queue.discard(runId(404))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a queued run can be discarded: it is never sent and its prediction goes', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    expect(k.store.facts.feature(T)?.properties['befund']).toBe('A');
    await k.queue.discard(runId(1));
    expect(await k.store.readRuns()).toEqual([]);
    expect(k.store.facts.feature(T)?.properties['befund']).toBe('unauffällig');
    await k.queue.drain();
    expect(k.server.sent).toHaveLength(0);
  });

  it('a run being sent cannot be discarded until the send settles', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const send = k.server.send.bind(k.server);
    k.server.send = async (p) => {
      await gate;
      return send(p);
    };
    const draining = k.queue.drain();
    await vi.waitFor(() => expect(k.queue.status().sending).toBe(runId(1)));
    await expect(k.queue.discard(runId(1))).rejects.toMatchObject({ code: 'not_discardable' });
    release();
    await draining;
    expect(k.server.sent).toHaveLength(1);
  });

  it('exports also when the store is unavailable', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    k.store.close();
    const json = JSON.parse(await k.queue.exportQueue()) as { runs: unknown[] };
    expect(json.runs).toHaveLength(1);
  });
});
