// WP-578: the queue schedules its own retry after a backoff through the injected Timers port.
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureId } from '@ueberblick/core/model';
import type { RunReply } from './contract';
import { IDS, befundErgaenzen, makeKit, memoryLock, type Kit, type KitOptions } from './queue.testing';

const T: FeatureId = IDS.t_in;
const offline = (): Promise<RunReply> => Promise.reject(new Error('offline'));

/** Fires the single pending timer after moving the monotonic clock as the real timer would have. */
async function fireRetry(k: Kit): Promise<void> {
  const timer = k.timers.pending[0];
  if (timer === undefined) throw new Error('no retry scheduled');
  const sent = k.server.sent.length;
  k.mono.t += timer.ms;
  k.timers.fire();
  await vi.waitFor(() => expect(k.server.sent.length).toBeGreaterThan(sent));
  await vi.waitFor(() => expect(k.queue.status().sending).toBeUndefined());
  await new Promise((r) => setTimeout(r, 5));
}

async function failedKit(o: KitOptions = {}): Promise<Kit> {
  const k = await makeKit(o);
  await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
  k.server.next = offline;
  await k.queue.drain();
  return k;
}

/** The single pending timer; the test asserts exactly one is pending first. */
function onlyTimer(k: Kit) {
  const t = k.timers.pending[0];
  if (t === undefined) throw new Error('no retry scheduled');
  return t;
}

describe('the queue retries itself', () => {
  it('after a transient failure it drains again at retryInMs without any external call', async () => {
    const k = await failedKit();
    expect(k.timers.pending.map((t) => t.ms)).toEqual([2_000]);
    k.server.next = undefined;
    await fireRetry(k);
    expect(k.queue.status()).toMatchObject({ pending: 0, hold: undefined, retryInMs: undefined });
    expect(k.timers.pending).toHaveLength(0);
  });

  it('a failed retry schedules the next, doubled', async () => {
    const k = await failedKit();
    await fireRetry(k);
    expect(k.timers.pending.map((t) => t.ms)).toEqual([4_000]);
    expect(k.queue.status().hold).toBe('backoff');
  });

  it('resetBackoff cancels the pending retry', async () => {
    const k = await failedKit();
    k.queue.resetBackoff();
    expect(k.timers.pending).toHaveLength(0);
  });

  it('close cancels the pending retry and nothing is scheduled afterwards', async () => {
    const k = await failedKit();
    k.queue.close();
    expect(k.timers.pending).toHaveLength(0);
    await k.queue.drain();
    expect(k.timers.pending).toHaveLength(0);
  });

  it('a successful drain cancels the pending retry', async () => {
    const k = await failedKit();
    k.mono.t += 2_000;
    k.server.next = undefined;
    await k.queue.drain();
    expect(k.timers.pending).toHaveLength(0);
  });

  it('a status change inside the backoff does not schedule a second retry', async () => {
    const k = await failedKit();
    await k.queue.enqueue(befundErgaenzen(2, T, 'B'));
    await k.queue.drain();
    expect(k.timers.pending).toHaveLength(1);
  });

  it('a self-retry that throws reaches onError', async () => {
    const k = await failedKit();
    const boom = new Error('store gone');
    k.deps.lock.tryRun = () => Promise.reject(boom);
    k.mono.t += 2_000;
    k.timers.fire();
    await vi.waitFor(() => expect(k.errors).toEqual([boom]));
  });

  it('a retry that finds the cross-tab lock busy re-arms after baseMs without looping', async () => {
    const lock = memoryLock();
    const k = await failedKit({ lock });
    expect(k.timers.pending.map((t) => t.ms)).toEqual([2_000]);
    const attempts = vi.spyOn(k.deps.lock, 'tryRun');
    lock.setHeld(true);
    k.mono.t += 2_000;
    k.timers.fire();
    // The retry found the lock busy: exactly one drain attempt, no synchronous re-entry.
    expect(attempts).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(k.timers.pending).toHaveLength(1));
    expect(onlyTimer(k).ms).toBe(2_000);
    k.mono.t += 2_000;
    k.timers.fire();
    // Still busy: one more attempt only, re-armed again at baseMs (no spin).
    expect(attempts).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(k.timers.pending).toHaveLength(1));
    expect(onlyTimer(k).ms).toBe(2_000);
    lock.setHeld(false);
    k.server.next = undefined;
    k.mono.t += 2_000;
    k.timers.fire();
    expect(attempts).toHaveBeenCalledTimes(3);
    await vi.waitFor(() => expect(k.queue.status().pending).toBe(0));
    expect(k.queue.status()).toMatchObject({ pending: 0, hold: undefined, retryInMs: undefined });
    expect(k.timers.pending).toHaveLength(0);
    expect(attempts).toHaveBeenCalledTimes(3);
  });

  it('the incompatible_protocol hold never schedules a retry', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    k.server.next = () => Promise.resolve({ kind: 'incompatible', v: 99 });
    await k.queue.drain();
    expect(k.queue.status().hold).toBe('incompatible_protocol');
    expect(k.timers.pending).toHaveLength(0);
    k.queue.resetBackoff();
    await k.queue.drain();
    expect(k.timers.pending).toHaveLength(0);
  });

  it('an auth_expired hold schedules no retry either', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    k.server.next = () => Promise.resolve({ kind: 'unauthenticated' });
    await k.queue.drain();
    expect(k.timers.pending).toHaveLength(0);
  });

  it('property: over random event sequences at most one retry is pending, and only while in backoff', async () => {
    const event = fc.constantFrom('fail', 'ok', 'reset', 'enqueue', 'fire', 'close');
    await fc.assert(
      fc.asyncProperty(fc.array(event, { minLength: 1, maxLength: 14 }), async (events) => {
        const k = await makeKit();
        let n = 0;
        let closed = false;
        await k.queue.enqueue(befundErgaenzen(++n, T, 'A'));
        for (const e of events) {
          if (e === 'fail' || e === 'ok') {
            k.server.next = e === 'fail' ? offline : undefined;
            k.mono.t += 10;
            await k.queue.drain();
          } else if (e === 'reset') k.queue.resetBackoff();
          else if (e === 'enqueue') await k.queue.enqueue(befundErgaenzen(++n, T, 'B'));
          else if (e === 'close') {
            k.queue.close();
            closed = true;
          } else if (k.timers.pending.length > 0) await fireRetry(k);
          const pending = k.timers.pending.length;
          expect(pending).toBeLessThanOrEqual(1);
          if (k.queue.status().hold !== 'backoff' || closed) expect(pending).toBe(0);
        }
      }),
      { numRuns: 40 },
    );
  });
});
