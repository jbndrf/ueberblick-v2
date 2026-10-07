// WP-511: QueueStatus for the header.
import { describe, expect, it } from 'vitest';
import { IDS, befundErgaenzen, makeKit } from './queue.testing';

const T = IDS.t_in;

describe('status', () => {
  it('reports pending count and the age of the oldest pending run, never negative', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    expect(k.queue.status()).toMatchObject({ pending: 1, oldestPendingAgeMs: 0 });
    k.clock.advance(90_000);
    expect(k.queue.status().oldestPendingAgeMs).toBe(90_000);
    await k.queue.enqueue(befundErgaenzen(2, T, 'B'));
    expect(k.queue.status().oldestPendingAgeMs).toBe(90_000);
    k.clock.set('2001-01-01T00:00:00.000Z');
    await k.queue.enqueue(befundErgaenzen(3, T, 'C'));
    expect(k.queue.status().oldestPendingAgeMs).toBe(0);
  });

  it('notifies subscribers after each change', async () => {
    const k = await makeKit();
    const seen: number[] = [];
    k.queue.subscribe((s) => seen.push(s.pending));
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    await k.queue.drain();
    expect(seen).toContain(1);
    expect(seen.at(-1)).toBe(0);
  });
});

describe('incompatible protocol', () => {
  it('holds the queue honestly: no retry, no backoff, no run lost, not reset by online', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    await k.queue.enqueue(befundErgaenzen(2, T, 'B'));
    k.server.next = () => Promise.resolve({ kind: 'incompatible', v: 99 });
    const res = await k.queue.drain();
    expect(res).toMatchObject({ hold: 'incompatible_protocol', accepted: 0, refused: 0 });
    expect(k.queue.status()).toMatchObject({
      pending: 2,
      hold: 'incompatible_protocol',
      serverProtocol: 99,
      retryInMs: undefined,
      refused: [],
    });
    expect(k.server.sent).toHaveLength(1);
    k.queue.resetBackoff();
    k.server.next = undefined;
    await k.queue.drain();
    expect(k.server.sent).toHaveLength(1); // never retried while incompatible
    expect((await k.store.readRuns()).map((r) => r.state)).toEqual(['queued', 'queued']);
  });
});
