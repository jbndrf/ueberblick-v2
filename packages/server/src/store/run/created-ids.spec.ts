// WP-748: the server stores a created feature (and a rule-created one) under the ids a device plans for the run.
import { describe, expect, it } from 'vitest';
import { seededIds } from '@ueberblick/core/plan';
import type { Json } from '@ueberblick/core';
import { IDS, anna, seedMusterstadt, setup, vera } from './testkit';

const tree: Record<string, Json> = {
  vitalitaet: 'v2',
  geometrie: { type: 'Point', coordinates: [7.1, 50.735] },
};

describe('ids of created features (device and server agree)', () => {
  it('a created feature is stored under seededIds(run.id), not a clock id', () => {
    const c = setup();
    seedMusterstadt(c);
    const run = c.run('erfassen', vera, tree);
    const r = c.store.submit(run);
    if (r.outcome !== 'accepted') throw new Error('refused');
    const created = r.observations.find((o) => o.property === '$type')?.featureId;
    expect(created).toBe(seededIds(run.id).featureId());
  });

  it('a rule-created feature and its rule run keep the seeded ids', () => {
    const c = setup();
    seedMusterstadt(c);
    const run = c.run('kontrolle', anna, { vitalitaet: 'v3', befund: 'Pilzbefall' }, IDS.t_in);
    const r = c.store.submit(run);
    if (r.outcome !== 'accepted') throw new Error('refused');
    const s = seededIds(run.id);
    const made = r.observations.find((o) => o.property === '$type' && o.result === 'massnahme');
    expect(made?.featureId).toBe(s.featureId());
    const rule = c.db.prepare<{ id: string }>('SELECT id FROM runs WHERE caused_by = ?').get(run.id);
    expect(rule?.id).toBe(s.runId());
  });

  it('a run that creates onto an existing feature id is refused (id_taken) and writes nothing', () => {
    const c = setup();
    seedMusterstadt(c);
    const before = c.db.prepare<{ n: number }>('SELECT count(*) AS n FROM observations').get()?.n;
    const r = c.store.submit(c.run('erfassen', vera, tree, IDS.t_in));
    expect(r.outcome).toBe('refused');
    if (r.outcome === 'refused') expect(r.refusal.code).toBe('id_taken');
    expect(c.db.prepare<{ n: number }>('SELECT count(*) AS n FROM observations').get()?.n).toBe(before);
  });

  it('a rule-created child whose seeded id already exists is refused (id_taken), the run writes nothing', () => {
    const c = setup();
    seedMusterstadt(c);
    const run = c.run('kontrolle', anna, { vitalitaet: 'v3', befund: 'Pilzbefall' }, IDS.t_in);
    c.seed([{ id: seededIds(run.id).featureId(), type: 'baumart', properties: { name_de: 'Opfer' } }]);
    const before = c.db.prepare<{ n: number }>('SELECT count(*) AS n FROM observations').get()?.n;
    const r = c.store.submit(run);
    expect(r.outcome).toBe('refused');
    if (r.outcome === 'refused') expect(r.refusal.code).toBe('id_taken');
    expect(c.db.prepare<{ n: number }>('SELECT count(*) AS n FROM observations').get()?.n).toBe(before);
  });

  it('a rule run whose seeded id already exists in the ledger is refused (id_taken), nothing is written (WP-750)', () => {
    const c = setup();
    seedMusterstadt(c);
    const run = c.run('kontrolle', anna, { vitalitaet: 'v3', befund: 'Pilzbefall' }, IDS.t_in);
    c.db
      .prepare(
        `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome, result)
         VALUES (?, 'u1', 'participant', 't', 1, '{}', '2026-01-01T00:00:00.000Z', 'accepted', '{"seq":{"from":1,"to":0}}')`,
      )
      .run(seededIds(run.id).runId());
    const count = (t: string) => c.db.prepare<{ n: number }>(`SELECT count(*) AS n FROM ${t}`).get()?.n;
    const before = { obs: count('observations'), runs: count('runs') };
    const r = c.store.submit(run);
    expect(r.outcome).toBe('refused');
    if (r.outcome === 'refused') expect(r.refusal.code).toBe('id_taken');
    expect(count('observations')).toBe(before.obs);
    // only the refused submitted run's ledger row is added
    expect(count('runs')).toBe((before.runs ?? 0) + 1);
  });
});
