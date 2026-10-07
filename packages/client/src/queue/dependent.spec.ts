// WP-767: a run made invalid by a refused create is stored as `dependent` and carries the culprit (v3 `dependent_rejected`).
import { describe, expect, it } from 'vitest';
import type { FeatureId, Key, Run } from '@ueberblick/core/model';
import { IDS, anna, befundErgaenzen, makeKit, refusal, runId } from './queue.testing';

const erfassen = (n: number): Run => ({
  id: runId(n),
  task: 'erfassen' as Key,
  actor: anna,
  configVersion: 1,
  input: { geometrie: { type: 'Point', coordinates: [7.102, 50.732] }, vitalitaet: 'v1' },
});

describe('dependent runs after a refusal', () => {
  it('a run on the feature a refused create made is stored dependent, with the culprit and its refusal', async () => {
    const k = await makeKit();
    const create = await k.queue.enqueue(erfassen(1));
    const made = (create.ok ? create.created[runId(1)] : undefined)?.[0] as FeatureId;
    expect(made).toBeDefined();
    expect(await k.queue.enqueue(befundErgaenzen(2, made, 'Pilz'))).toMatchObject({ ok: true });
    k.server.script = { refuse: (run) => (run.id === runId(1) ? refusal('not_permitted') : undefined) };
    await k.queue.drain();
    const rows = await k.store.readRuns();
    const first = rows.find((r) => r.run.id === runId(1));
    const second = rows.find((r) => r.run.id === runId(2));
    expect(first?.state).toBe('refused');
    expect(second?.state).toBe('dependent');
    expect(second?.refusal?.code).toBe('not_permitted'); // the culprit's refusal
    expect(second?.refusal?.message).toContain(runId(1));
    expect(second?.run.input).toEqual({ befund: 'Pilz' }); // the typed input is kept
    expect(k.queue.status().refused.map((r) => r.runId)).toEqual([runId(1), runId(2)]);
    // never sent: the server saw the create only
    expect(k.server.sent.map((p) => (p.kind === 'run' ? p.run.id : ''))).toEqual([runId(1)]);
  });

  it('a run refused for its own reason is plain refused, not dependent', async () => {
    const k = await makeKit();
    await k.queue.enqueue(befundErgaenzen(1, IDS.t_in, 'A'));
    await k.queue.enqueue(befundErgaenzen(2, IDS.t_hole, 'B'));
    k.server.script = {
      refuse: (run) => (run.id === runId(1) ? refusal('not_permitted') : undefined),
    };
    await k.queue.drain();
    const rows = await k.store.readRuns();
    expect(rows.find((r) => r.run.id === runId(1))?.state).toBe('refused');
    expect(rows.find((r) => r.run.id === runId(2))?.state).toBe('accepted');
  });

  it('a later run that fails on a feature the refused run did not create stays plain refused', async () => {
    const k = await makeKit();
    const create = await k.queue.enqueue(erfassen(1));
    const made = (create.ok ? create.created[runId(1)] : undefined)?.[0];
    expect(made).toBeDefined();
    await k.queue.enqueue(befundErgaenzen(2, IDS.t_in, 'A'));
    k.server.script = { refuse: (run) => (run.id === runId(1) ? refusal('not_permitted') : undefined) };
    await k.queue.drain();
    const rows = await k.store.readRuns();
    expect(rows.find((r) => r.run.id === runId(2))?.state).toBe('accepted');
  });

  it('a dependent run can be sent again and discarded like a refused one', async () => {
    const k = await makeKit();
    const create = await k.queue.enqueue(erfassen(1));
    const made = (create.ok ? create.created[runId(1)] : undefined)?.[0] as FeatureId;
    await k.queue.enqueue(befundErgaenzen(2, made, 'Pilz'));
    k.server.script = { refuse: (run) => (run.id === runId(1) ? refusal('not_permitted') : undefined) };
    await k.queue.drain();
    await k.queue.discard(runId(2));
    expect((await k.store.readRuns()).map((r) => r.run.id)).toEqual([runId(1)]);
  });

  it('a re-derivation that runs while the create is refused leaves no prediction of the refused Objekt (WP-796)', async () => {
    const k = await makeKit();
    const create = await k.queue.enqueue(erfassen(1));
    const made = (create.ok ? create.created[runId(1)] : undefined)?.[0] as FeatureId;
    await k.queue.enqueue(befundErgaenzen(2, made, 'Pilz'));
    k.server.script = { refuse: (run) => (run.id === runId(1) ? refusal('not_permitted') : undefined) };
    await Promise.all([k.queue.drain(), k.queue.rederive('scope_changed')]);
    await k.queue.rederive('scope_changed');
    expect(k.store.facts.feature(made)).toBeUndefined();
  });
});
