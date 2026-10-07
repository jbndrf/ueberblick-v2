// WP-788: v3 closes the form as soon as the run is stored (the v3 detail module (`map/modules/…-detail/…Module.svelte:754-756`): `await
// submitTask(...)` then `activeModelTask = null`). Only a refusal the device itself makes at once (v3
// `TaskRunRejectedError`, `:205-210`, kept in `localRejection`) keeps the form open. A refusal the server makes later
// shows in the feature sheet's run notices (`TaskRunNotices`), so the form does not wait for it.
import { describe, expect, it, vi } from 'vitest';
import type { RunDraft, RunProgress, RunSubmitter } from '@ueberblick/ui';
import type { RunId } from '@ueberblick/core/model';
import { closeOnResult } from './close-on-result';

function fake(o: { refuse?: Set<string>; late?: boolean } = {}) {
  const listeners = new Map<string, (p: RunProgress) => void>();
  const inner: RunSubmitter = {
    submit: async () => 'queued',
    // like the device: the first progress arrives after the stored row is read, so a device refusal shows in it
    outcome: (id, l) => {
      listeners.set(id, l);
      const first: RunProgress = o.refuse?.has(id) ? { state: 'refused', reason: 'no' } : { state: 'queued' };
      if (o.late) setTimeout(() => listeners.has(id) && l(first), 0);
      else l(first);
      return () => listeners.delete(id);
    },
  };
  const run = (id: string): RunDraft => ({ id: id as RunId, task: 'aufgabe' as never, input: {} });
  return { inner, listeners, run };
}

describe('closeOnResult', () => {
  it('closes as soon as the run is stored and queued; it does not wait for the server (accepted never comes)', async () => {
    const { inner, run } = fake();
    const onclose = vi.fn();
    const s = closeOnResult(inner, { onclose });
    await s.submit(run('r1'));
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('several runs close the form once, when every run has been stored', async () => {
    const { inner, listeners, run } = fake();
    const onclose = vi.fn();
    const s = closeOnResult(inner, { onclose });
    await Promise.all([s.submit(run('r1')), s.submit(run('r2'))]);
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it('a refusal that comes back at once keeps the form open (v3 localRejection); the retry closes it', async () => {
    const { inner, run } = fake({ refuse: new Set(['r1']) });
    const onclose = vi.fn();
    const s = closeOnResult(inner, { onclose });
    await s.submit(run('r1'));
    expect(onclose).not.toHaveBeenCalled();
    await s.submit(run('r2'));
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('a later refusal by the server does not reopen or re-close anything', async () => {
    const { inner, listeners, run } = fake();
    const onclose = vi.fn();
    const s = closeOnResult(inner, { onclose });
    await s.submit(run('r1'));
    listeners.get('r1')?.({ state: 'refused', reason: 'no' });
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('a run that could not be stored closes nothing', async () => {
    const { run } = fake();
    const onclose = vi.fn();
    const s = closeOnResult(
      { submit: async () => Promise.reject(new Error('disk full')), outcome: () => () => undefined },
      { onclose },
    );
    await expect(s.submit(run('r1'))).rejects.toThrow('disk full');
    expect(onclose).not.toHaveBeenCalled();
  });

  it('after dispose a late result closes nothing (it must not close the next form)', async () => {
    const { inner, run } = fake({ late: true });
    const onclose = vi.fn();
    const s = closeOnResult(inner, { onclose });
    await s.submit(run('r1'));
    s.dispose();
    await new Promise((r) => setTimeout(r, 0));
    expect(onclose).not.toHaveBeenCalled();
  });
});
