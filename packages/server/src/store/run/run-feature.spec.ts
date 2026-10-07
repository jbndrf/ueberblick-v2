// WP-362: `runs.feature_id` is written in the run transaction (update run, accepted create run, refused create run).
import { describe, expect, it } from 'vitest';
import type { Json } from '@ueberblick/core';
import { IDS, anna, seedMusterstadt, setup, vera } from './testkit';

const featureOf = (db: ReturnType<typeof setup>['db'], id: string): string | null =>
  (
    db.prepare<{ feature_id: string | null }>('SELECT feature_id FROM runs WHERE id = ?').get(id) as {
      feature_id: string | null;
    }
  ).feature_id;

const tree: Record<string, Json> = {
  vitalitaet: 'v2',
  geometrie: { type: 'Point', coordinates: [7.1, 50.735] },
};

describe('runs.feature_id', () => {
  it('an update run stores its featureId, accepted or refused', () => {
    const c = setup();
    seedMusterstadt(c);
    const ok = c.run('kontrolle', anna, { vitalitaet: 'v2', befund: 'Kronenpflege' }, IDS.t_in);
    const bad = c.run('kontrolle', anna, { vitalitaet: 'v2', befund: 'unauffällig' }, IDS.t_in);
    expect(c.store.submit(bad).outcome).toBe('refused');
    expect(c.store.submit(ok).outcome).toBe('accepted');
    expect(featureOf(c.db, ok.id)).toBe(IDS.t_in);
    expect(featureOf(c.db, bad.id)).toBe(IDS.t_in);
  });

  it('an accepted create run stores the created feature, a refused one null', () => {
    const c = setup();
    seedMusterstadt(c);
    const ok = c.run('erfassen', vera, tree);
    const r = c.store.submit(ok);
    if (r.outcome !== 'accepted') throw new Error('refused');
    const created = r.observations.find((o) => o.property === '$type')?.featureId;
    expect(featureOf(c.db, ok.id)).toBe(created);
    const bad = c.run('erfassen', vera, { vitalitaet: 'v1' });
    expect(c.store.submit(bad).outcome).toBe('refused');
    expect(featureOf(c.db, bad.id)).toBeNull();
  });
});
