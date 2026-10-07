// WP-837: a refusal the device itself makes (v3 `TaskRunRejectedError`, detail module :205-211) is not a stored run: the
// submit fails with the reason, the refused draft is dropped, and the person sees v3's red "Nicht möglich" box with the
// form still open. A server refusal later is not touched here (it keeps its run notice).
import { describe, expect, it, vi } from 'vitest';
import type { RunDraft, RunProgress, RunSubmitter } from '@ueberblick/ui';
import type { RunId } from '@ueberblick/core/model';
import { LocalRefusalError, localRefusal } from './local-refusal';

const run = (id: string): RunDraft => ({ id: id as RunId, task: 'aufgabe' as never, input: {} });
const inner = (first: RunProgress): RunSubmitter => ({
  submit: async () => 'queued',
  outcome: (_id, l) => {
    l(first);
    return () => undefined;
  },
});

describe('localRefusal', () => {
  it('a run refused at once is discarded, reported with its reason, and the submit fails', async () => {
    const discard = vi.fn(async () => undefined);
    const onrefused = vi.fn();
    const s = localRefusal(inner({ state: 'refused', reason: 'Nicht erlaubt.' }), { discard, onrefused });
    await expect(s.submit(run('r1'))).rejects.toBeInstanceOf(LocalRefusalError);
    expect(discard).toHaveBeenCalledWith('r1');
    expect(onrefused).toHaveBeenCalledWith('Nicht erlaubt.');
  });

  it('a queued run passes through untouched', async () => {
    const discard = vi.fn(async () => undefined);
    const onrefused = vi.fn();
    const s = localRefusal(inner({ state: 'queued' }), { discard, onrefused });
    await expect(s.submit(run('r1'))).resolves.toBe('queued');
    expect(discard).not.toHaveBeenCalled();
    expect(onrefused).not.toHaveBeenCalled();
  });

  it('a successful submit clears an earlier notice', async () => {
    const onaccepted = vi.fn();
    const s = localRefusal(inner({ state: 'queued' }), {
      discard: async () => undefined,
      onrefused: () => undefined,
      onstored: onaccepted,
    });
    await s.submit(run('r1'));
    expect(onaccepted).toHaveBeenCalledTimes(1);
  });
});
