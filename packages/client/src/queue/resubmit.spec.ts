// WP-764: "Erneut senden" uploads at once, like a new local run (v3 resendTaskRun ends in notifyLocalWrite()).
import { describe, expect, it, vi } from 'vitest';
import type { FeatureId } from '@ueberblick/core/model';
import type { RunReply } from './contract';
import { IDS, befundErgaenzen, makeKit, runId, refusal, type Kit } from './queue.testing';

const T: FeatureId = IDS.t_in;

async function refusedKit(): Promise<Kit> {
  const k = await makeKit();
  await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
  k.server.script = { refuse: () => refusal('not_available') };
  await k.queue.drain();
  k.server.script = {};
  k.server.sent.length = 0;
  return k;
}

describe('resubmit drains by itself', () => {
  it('online: the resubmitted run is sent once, with no explicit drain', async () => {
    const k = await refusedKit();
    const res = await k.queue.resubmit(runId(1));
    expect(res.ok).toBe(true);
    await vi.waitFor(() => expect(k.queue.status().awaitingPull).toBe(1));
    expect(k.server.sent).toHaveLength(1);
    expect(k.queue.status().pending).toBe(0);
  });

  it('offline: the attempt fails transiently and the run waits, as before', async () => {
    const k = await refusedKit();
    k.server.next = (): Promise<RunReply> => Promise.reject(new Error('offline'));
    await k.queue.resubmit(runId(1));
    await vi.waitFor(() => expect(k.queue.status().hold).toBe('backoff'));
    expect(k.queue.status().pending).toBe(1);
    expect(k.server.applied.size).toBe(0);
  });
});
