// WP-681: the queue reports which features a submitted run created (taken from its plan), stable across re-plans.
import { describe, expect, it } from 'vitest';
import type { Actor, FeatureId, Key, Run } from '@ueberblick/core/model';
import { IDS, anna, befundErgaenzen, kontrolle, makeKit, refusal, runId } from './queue.testing';

const verwaltung: Actor = { id: 'vera', kind: 'participant', roles: ['verwaltung' as Key] };
const baumart = (n: number, name = 'Eiche'): Run => ({
  id: runId(n),
  task: 'baumart_anlegen' as Key,
  actor: verwaltung,
  configVersion: 1,
  input: { name_de: name },
});
/** vitalitaet v4 makes the rule create a `massnahme`: a feature of the run's rule run, not of the run itself. */
const schaden = (n: number): Run =>
  kontrolle(n, IDS.t_in, 'Pilz', {
    actor: anna,
    input: {
      vitalitaet: 'v4',
      befund: 'Pilz',
      foto: [{ sha256: 'aa11', name: 's.jpg', mime: 'image/jpeg' }],
    },
  });

describe('created features of a submitted run', () => {
  it('a create without a map position reports the id its plan minted, and the device knows that feature', async () => {
    const k = await makeKit();
    const res = await k.queue.enqueue(baumart(1));
    expect(res.ok).toBe(true);
    const created = res.ok ? (res.created[runId(1)] ?? []) : [];
    expect(created).toHaveLength(1);
    const id = created[0] as FeatureId;
    expect(k.store.facts.feature(id)?.type).toBe('baumart');
    expect(k.queue.createdBy(runId(1))).toEqual([id]);
  });

  it('a run that creates nothing reports an empty list', async () => {
    const k = await makeKit();
    const res = await k.queue.enqueue(befundErgaenzen(1, IDS.t_in, 'X'));
    expect(res).toMatchObject({ ok: true, created: { [runId(1)]: [] } });
  });

  it('a feature that only a rule created is not reported for the run', async () => {
    const k = await makeKit();
    const res = await k.queue.enqueue(schaden(1));
    expect(res).toMatchObject({ ok: true, created: { [runId(1)]: [] } });
  });

  it('a refused run reports nothing', async () => {
    const k = await makeKit();
    const res = await k.queue.enqueue({ ...baumart(1), actor: anna }); // anna may not create a species
    expect(res.ok).toBe(false);
    expect(res.ok ? undefined : 'created' in res).toBe(false);
    expect(k.queue.createdBy(runId(1))).toEqual([]);
  });

  it('keeps the same id after a rebase (an earlier run is refused) and after a re-derivation', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, IDS.t_hole, 'X'));
    const res = await k.queue.enqueue(baumart(2));
    const before = res.ok ? res.created[runId(2)] : undefined;
    expect(before).toHaveLength(1);
    k.server.script = { refuse: (run) => (run.id === runId(1) ? refusal('not_permitted') : undefined) };
    await k.queue.drain();
    expect(k.queue.createdBy(runId(2))).toEqual(before);
    await k.queue.rederive('snapshot' as never);
    expect(k.queue.createdBy(runId(2))).toEqual(before);
    expect(k.store.facts.feature(before?.[0] as FeatureId)?.type).toBe('baumart');
  });

  it('is still known after the run was accepted and pulled', async () => {
    const k = await makeKit();
    const res = await k.queue.enqueue(baumart(1));
    const ids = res.ok ? res.created[runId(1)] : undefined;
    await k.queue.drain();
    await k.queue.onPulled(1_000_000 as never);
    expect(k.queue.createdBy(runId(1))).toEqual(ids);
  });

  it('every run of a batch has its own entry', async () => {
    const k = await makeKit();
    const res = await k.queue.submit([baumart(1, 'A'), baumart(2, 'B')]);
    expect(res.ok && Object.keys(res.created).sort()).toEqual([runId(1), runId(2)]);
    expect(res.ok && res.created[runId(1)]?.[0]).not.toBe(res.ok && res.created[runId(2)]?.[0]);
  });
});
