// WP-306: audit metadata of a created feature, stored by the run transaction, and `self.$…` system fields in SQL.
import { describe, expect, it } from 'vitest';
import type { FeatureId, Json } from '@ueberblick/core';
import { anna, setup, seedMusterstadt, vera, type Ctx } from './testkit';
import { mismatches } from './verify.testkit';

let tick = 0;
const at = (): string => new Date(Date.UTC(2026, 4, 1, 8, 0, ++tick)).toISOString();
const pt: Json = { type: 'Point', coordinates: [7.1, 50.73] };

interface Audit {
  created_by: string | null;
  created_at: string | null;
  changed_at: string | null;
}
const audit = (c: Ctx, id: string): Audit | undefined =>
  c.db.prepare<Audit>('SELECT created_by, created_at, changed_at FROM features WHERE id = ?').get(id);

describe('audit metadata of a created feature', () => {
  it('stores the actor, the creation time and the newest time; a later run moves only the last', () => {
    const c = setup({ clock: { now: at } });
    seedMusterstadt(c);
    const made = c.store.submit(
      c.run('erfassen', anna, { vitalitaet: 'v2', geometrie: pt }, undefined, { clientTime: at() }),
    );
    if (made.outcome !== 'accepted') throw new Error('erfassen refused');
    const id = made.observations.find((o) => o.property === '$created_by')?.featureId as FeatureId;
    expect(made.observations.find((o) => o.property === '$created_by')?.result).toBe('anna');
    const first = audit(c, id);
    expect(first?.created_by).toBe('anna');
    expect(first?.created_at).not.toBeNull();
    expect(first?.changed_at).toBe(first?.created_at);

    const moved = c.store.submit(c.run('verschieben', vera, { geometrie: pt }, id, { clientTime: at() }));
    expect(moved.outcome).toBe('accepted');
    const second = audit(c, id);
    expect(second?.created_by).toBe('anna');
    expect(second?.created_at).toBe(first?.created_at);
    expect((second?.changed_at as string) > (first?.changed_at as string)).toBe(true);
    expect(mismatches(c)).toEqual([]);
    c.db.close();
  });

  it('a run without a client time still names the creator (the times are stamped, see stamp.spec.ts)', () => {
    const c = setup();
    seedMusterstadt(c);
    const made = c.store.submit(c.run('erfassen', anna, { vitalitaet: 'v2', geometrie: pt }));
    if (made.outcome !== 'accepted') throw new Error('erfassen refused');
    const id = made.observations.find((o) => o.property === '$created_by')?.featureId as FeatureId;
    expect(audit(c, id)?.created_by).toBe('anna');
    c.db.close();
  });

  it('the created_by observation is never a property of the feature', () => {
    const c = setup();
    seedMusterstadt(c);
    const made = c.store.submit(c.run('erfassen', anna, { vitalitaet: 'v2', geometrie: pt }));
    if (made.outcome !== 'accepted') throw new Error('erfassen refused');
    const id = made.observations.find((o) => o.property === '$created_by')?.featureId as FeatureId;
    expect(c.store.facts.feature(id)?.properties).not.toHaveProperty('$created_by');
    expect(c.store.facts.feature(id)?.createdBy).toBe('anna');
    c.db.close();
  });
});

describe('the migration back-fills existing features', () => {
  it('reads the creator from the run of the $type observation and the times from the observations', async () => {
    const { openProjectDb } = await import('../../db/open');
    const { PROJECT_MIGRATIONS } = await import('../../db/project-schema');
    const { migrate } = await import('../../db/migrate');
    const db = openProjectDb(':memory:', 'test');
    // Roll the audit migration back by hand: drop its index and columns, then clear the migration row.
    const last = PROJECT_MIGRATIONS.find((m) => m.name === 'features_audit');
    expect(last?.name).toBe('features_audit');
    db.exec('DROP INDEX features_by_creator');
    db.exec('DROP INDEX features_by_creator_any'); // WP-639's index over created_by
    for (const col of ['created_by', 'created_at', 'changed_at'])
      db.exec(`ALTER TABLE features DROP COLUMN ${col}`);
    db.prepare('DELETE FROM schema_migrations WHERE id = ?').run(last?.id as number);
    const run = (id: string, actor: string): void =>
      void db
        .prepare(
          `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome)
           VALUES (?, ?, 'participant', 't', 1, '{}', 'x', 'accepted')`,
        )
        .run(id, actor);
    run('r1', 'anna');
    run('r2', 'vera');
    const obs = db.prepare(
      'INSERT INTO observations (seq, run_id, feature_id, property, result, phenomenon_time) VALUES (?, ?, ?, ?, ?, ?)',
    );
    obs.run(1, 'r1', 'f1', '$type', '"baum"', '2026-01-01T00:00:00.000Z');
    obs.run(2, 'r2', 'f1', 'name', '"x"', '2026-02-01T00:00:00.000Z');
    obs.run(3, 'r2', 'f1', 'name', '"y"', null);
    obs.run(4, 'r1', 'f2', '$type', '"baum"', null);
    for (const id of ['f1', 'f2'])
      db.prepare(
        "INSERT INTO features (id, type, config_version, properties, updated_seq) VALUES (?, 'baum', 1, '{}', 1)",
      ).run(id);
    expect(migrate(db, PROJECT_MIGRATIONS)).toEqual([last?.id]);
    const rows = db
      .prepare<Audit & { id: string }>(
        'SELECT id, created_by, created_at, changed_at FROM features ORDER BY id',
      )
      .all();
    expect(rows).toEqual([
      {
        id: 'f1',
        created_by: 'anna',
        created_at: '2026-01-01T00:00:00.000Z',
        changed_at: '2026-02-01T00:00:00.000Z',
      },
      { id: 'f2', created_by: 'anna', created_at: null, changed_at: null },
    ]);
    db.close();
  });
});
