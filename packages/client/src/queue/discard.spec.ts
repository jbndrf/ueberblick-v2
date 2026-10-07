// WP-627: discarding waiting runs is safe against the send loop, the cross-tab lock and dependents.
import { describe, expect, it, vi } from 'vitest';
import type { Actor, FeatureId, Key, Run } from '@ueberblick/core/model';
import { createRunQueue } from './queue';
import { IDS, befundErgaenzen, kontrolle, makeKit, memoryLock, runId } from './queue.testing';

const T: FeatureId = IDS.t_in;

describe('discard', () => {
  it('a discard while this tab drains, or while another tab holds the lock, neither discards nor double-sends', async () => {
    const lock = memoryLock();
    const k = await makeKit({ lock });
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    const other = await createRunQueue(k.deps); // a second tab: same store, same lock
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const send = k.server.send.bind(k.server);
    k.server.send = async (p) => {
      await gate;
      return send(p);
    };
    const draining = k.queue.drain();
    await vi.waitFor(() => expect(k.queue.status().sending).toBe(runId(1)));
    await expect(other.discard(runId(1))).rejects.toMatchObject({ code: 'not_discardable' });
    await expect(k.queue.discard(runId(1))).rejects.toMatchObject({ code: 'not_discardable' });
    release();
    await draining;
    expect(k.server.sent).toHaveLength(1);
    lock.setHeld(true); // another tab starts a send
    await k.queue.enqueue(befundErgaenzen(2, T, 'B'));
    await expect(k.queue.discard(runId(2))).rejects.toMatchObject({ code: 'not_discardable' });
    expect((await k.store.readRuns()).map((r) => r.run.id)).toContain(runId(2));
  });

  it('discarding a run re-plans the waiting runs that built on it', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, T, 'A'));
    await k.queue.enqueue(befundErgaenzen(2, T, 'B'));
    expect(k.store.facts.feature(T)?.properties['befund']).toBe('B');
    await k.queue.discard(runId(1));
    const rows = await k.store.readRuns();
    expect(rows.map((r) => r.run.id)).toEqual([runId(2)]);
    expect(rows[0]?.state).toBe('queued');
    expect(k.store.facts.feature(T)?.properties['befund']).toBe('B'); // run 2 was re-planned on the base state
    await k.queue.discard(runId(2));
    expect(k.store.facts.feature(T)?.properties['befund']).toBe('unauffällig');
  });

  it('a run that edits a feature another run created is refused locally when that run is discarded', async () => {
    const k = await makeKit();
    const bauhof: Actor = { id: 'bernd', kind: 'participant', roles: ['bauhof' as Key] };
    // vitalitaet v4: the rule creates a massnahme feature (predicted, found through its `baum` edge)
    const schaden = kontrolle(1, T, 'Pilz', {
      input: {
        vitalitaet: 'v4',
        befund: 'Pilz',
        foto: [{ sha256: 'aa11', name: 's.jpg', mime: 'image/jpeg' }],
      },
    });
    await k.queue.enqueue(schaden);
    const measures = (): readonly FeatureId[] =>
      k.store.facts
        .edgesTo(T)
        .filter((e) => k.store.facts.feature(e.from)?.type === 'massnahme')
        .map((e) => e.from);
    const [measure] = measures();
    expect(measure).toBeDefined();
    const erledigen: Run = {
      id: runId(2),
      task: 'massnahme_erledigen' as Key,
      actor: bauhof,
      configVersion: 1,
      featureId: measure as FeatureId,
      input: {},
    };
    expect(await k.queue.enqueue(erledigen)).toMatchObject({ ok: true });

    await k.queue.discard(runId(1));
    expect(measures()).toEqual([]);
    expect(k.store.facts.feature(measure as FeatureId)).toBeUndefined();
    const [row] = await k.store.readRuns();
    expect(row?.run.id).toBe(runId(2));
    expect(row?.state).toBe('refused');
    await k.queue.drain();
    expect(k.server.sent).toHaveLength(0); // never sent
  });
});
