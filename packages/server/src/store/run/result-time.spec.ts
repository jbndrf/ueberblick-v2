// WP-794: the intake stamps the O&M resultTime on every observation, in one place (core `resultTimeOf`).
import { describe, expect, it } from 'vitest';
import type { FeatureId, Json } from '@ueberblick/core';
import { actor, anna, seedMusterstadt, setup } from './testkit';

const pt: Json = { type: 'Point', coordinates: [7.1, 50.73] };
const MONDAY = '2026-06-01T08:00:00.000Z';
const THURSDAY = '2026-06-04T14:00:00.000Z';
const HISTORIC = '2019-03-04T08:00:00.000Z';

describe('observations.result_time', () => {
  it('a participant run synced on Thursday gets Thursday on every observation, the work time stays Monday', () => {
    const c = setup({ clock: { now: () => THURSDAY } });
    seedMusterstadt(c);
    const run = c.run('erfassen', anna, { vitalitaet: 'v2', geometrie: pt }, undefined, {
      clientTime: MONDAY,
    });
    const made = c.store.submit(run);
    if (made.outcome !== 'accepted') throw new Error('refused');
    const rows = c.db
      .prepare<{ phenomenon_time: string; result_time: string }>(
        'SELECT phenomenon_time, result_time FROM observations WHERE run_id = ?',
      )
      .all(run.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toEqual({ phenomenon_time: MONDAY, result_time: THURSDAY });
    expect(made.observations.every((o) => o.resultTime === THURSDAY)).toBe(true);
    // the ledger answers a repeat with the same stored result time, and received_at is the arrival time
    const again = c.store.submit(run);
    if (again.outcome !== 'accepted') throw new Error('refused');
    expect(again.observations).toEqual(made.observations);
    expect(
      c.db.prepare<{ received_at: string }>('SELECT received_at FROM runs WHERE id = ?').get(run.id)
        ?.received_at,
    ).toBe(THURSDAY);
    c.db.close();
  });

  it('an import run keeps its historical time as resultTime (the v3 migration keeps created and updated), received_at stays the arrival', () => {
    const c = setup({ clock: { now: () => THURSDAY } });
    seedMusterstadt(c);
    const run = c.run(
      'erfassen',
      actor('import', 'import-1', anna.roles),
      { vitalitaet: 'v2', geometrie: pt },
      undefined,
      {
        clientTime: HISTORIC,
      },
    );
    const made = c.store.submit(run);
    if (made.outcome !== 'accepted') throw new Error('refused');
    const id = made.observations[0]?.featureId as FeatureId;
    expect(
      c.db
        .prepare<{ created_at: string; changed_at: string }>(
          'SELECT created_at, changed_at FROM features WHERE id = ?',
        )
        .get(id),
    ).toEqual({ created_at: HISTORIC, changed_at: HISTORIC });
    expect(
      c.db.prepare<{ received_at: string }>('SELECT received_at FROM runs WHERE id = ?').get(run.id)
        ?.received_at,
    ).toBe(THURSDAY);
    c.db.close();
  });
});
