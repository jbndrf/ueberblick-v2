// WP-511 review 1: ids of what a plan creates are stable across re-plans (seeded from the run id).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Actor, FeatureId, Key, Run } from '@ueberblick/core/model';
import { seededIds } from '@ueberblick/core/plan';
import { IDS, befundErgaenzen, kontrolle, makeKit, refusal, runId } from './queue.testing';

const T = IDS.t_in;
const bauhof: Actor = { id: 'bernd', kind: 'participant', roles: ['bauhof' as Key] };
/** A kontrolle with vitalitaet v4: its stage becomes `massnahme`, so the rule makes a `massnahme` feature. */
const schaden = (n: number): Run =>
  kontrolle(n, T, 'Pilz', {
    input: {
      vitalitaet: 'v4',
      befund: 'Pilz',
      foto: [{ sha256: 'aa11', name: 's.jpg', mime: 'image/jpeg' }],
    },
  });

describe('seededIds', () => {
  it('is deterministic per seed and kind, distinct across them, and UUID-shaped', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (a, b) => {
        const one = seededIds(a as never);
        const two = seededIds(a as never);
        expect([one.featureId(), one.featureId(), one.runId()]).toEqual([
          two.featureId(),
          two.featureId(),
          two.runId(),
        ]);
        const s = seededIds(a as never);
        const ids = [s.featureId(), s.featureId(), s.runId(), s.runId()];
        expect(new Set(ids).size).toBe(4);
        if (a !== b) expect(seededIds(b as never).featureId()).not.toBe(ids[0]);
        for (const id of ids)
          expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }),
    );
  });
});

describe('a rule-created feature keeps its id across re-plans', () => {
  // predicted features are not in `featureIdsOfType` (committed rows only): find the measures through their `baum` edge
  const measures = (k: Awaited<ReturnType<typeof makeKit>>): readonly FeatureId[] =>
    k.store.facts
      .edgesTo(T)
      .filter((e) => k.store.facts.feature(e.from)?.type === 'massnahme')
      .map((e) => e.from)
      .sort();

  it('is identical after a rebase; a later queued run that refers to it stays valid', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, IDS.t_hole, 'X')); // will be refused: forces a rebase
    await k.queue.enqueue(schaden(2));
    const [measure] = measures(k);
    expect(measures(k)).toHaveLength(1);
    const erledigen: Run = {
      id: runId(3),
      task: 'massnahme_erledigen' as Key,
      actor: bauhof,
      configVersion: 1,
      featureId: measure as FeatureId,
      input: {},
    };
    const res = await k.queue.enqueue(erledigen);
    expect(res).toMatchObject({ ok: true });

    k.server.script = { refuse: (run) => (run.id === runId(1) ? refusal('not_permitted') : undefined) };
    await k.queue.drain();
    expect(measures(k)).toEqual([measure]);
    const status = k.queue.status();
    expect(status.refused.map((r) => r.runId)).toEqual([runId(1)]);
    expect(status.awaitingPull).toBe(2);
    expect(status.unpredicted).toEqual([]);
  });

  it('an accepted run makes no ghost twin when predictions are re-derived', async () => {
    const k = await makeKit();
    await k.queue.enqueue(schaden(1));
    await k.queue.drain();
    const before = measures(k);
    expect(before).toHaveLength(1);
    await k.queue.rederive('scope_changed');
    await k.queue.rederive('snapshot_restart');
    expect(measures(k)).toEqual(before);
  });

  it('the same id comes back after a restart (rebuild from the stored runs)', async () => {
    const k = await makeKit();
    await k.queue.enqueue(schaden(1));
    const before = measures(k);
    const { createRunQueue } = await import('./queue');
    await createRunQueue(k.deps);
    expect(measures(k)).toEqual(before);
  });
});
