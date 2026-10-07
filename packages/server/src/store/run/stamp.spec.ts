// WP-724: a run that arrives without a client time gets the server's time. WP-762: a participant's client time is
// clamped (it is the work time, `phenomenon_time`). WP-794 (owner M8 = b): the audit times are the server receive time.
import { describe, expect, it } from 'vitest';
import {
  AUDIT_CLOCK_SKEW_MS,
  AUDIT_MAX_OFFLINE_AGE_MS,
  type FeatureId,
  type Json,
  type Key,
} from '@ueberblick/core';
import { IDS, actor, anna, seedMusterstadt, setup, vera } from './testkit';

const pt: Json = { type: 'Point', coordinates: [7.1, 50.73] };
interface Audit {
  created_at: string | null;
  changed_at: string | null;
}
const audit = (db: ReturnType<typeof setup>['db'], id: string): Audit | undefined =>
  db.prepare<Audit>('SELECT created_at, changed_at FROM features WHERE id = ?').get(id);
/** The work time (`phenomenon_time`) of the feature's `$type` observation: what the clamp guards. */
const work = (db: ReturnType<typeof setup>['db'], id: string): string | null | undefined =>
  db
    .prepare<{ phenomenon_time: string | null }>(
      `SELECT phenomenon_time FROM observations WHERE feature_id = ? AND property = '$type'`,
    )
    .get(id)?.phenomenon_time;
const T1 = '2026-06-01T10:00:00.000Z';
const T2 = '2026-06-02T11:00:00.000Z';
const MONDAY = '2026-06-01T08:00:00.000Z';
const THURSDAY = '2026-06-04T14:00:00.000Z';
const FRIDAY = '2026-06-05T09:00:00.000Z';

function clocked(first: string) {
  const t = { now: first };
  return { t, c: setup({ clock: { now: () => t.now } }) };
}

describe('the store stamps the server time on a run without a client time', () => {
  it('create sets createdAt, a later unstamped run sets changedAt', () => {
    const { t, c } = clocked(T1);
    seedMusterstadt(c);
    const made = c.store.submit(c.run('erfassen', anna, { vitalitaet: 'v2', geometrie: pt }));
    if (made.outcome !== 'accepted') throw new Error('refused');
    const id = made.observations.find((o) => o.property === '$created_by')?.featureId as FeatureId;
    expect(audit(c.db, id)).toEqual({ created_at: T1, changed_at: T1 });
    t.now = T2;
    expect(c.store.submit(c.run('verschieben', vera, { geometrie: pt }, id)).outcome).toBe('accepted');
    expect(audit(c.db, id)).toEqual({ created_at: T1, changed_at: T2 });
    c.db.close();
  });

  it('a batch run is stamped too, and the ledger keeps the stamped time as client_time', () => {
    const { c } = clocked(T1);
    seedMusterstadt(c);
    const run = c.run('erfassen', anna, { vitalitaet: 'v2', geometrie: pt });
    expect(c.store.submitBatch([run]).outcome).toBe('accepted');
    const row = c.db
      .prepare<{ client_time: string | null }>('SELECT client_time FROM runs WHERE id = ?')
      .get(run.id);
    expect(row?.client_time).toBe(T1);
    c.db.close();
  });

  it('a client-supplied time is the work time; the audit times stay the receive time', () => {
    const { c } = clocked(T2);
    seedMusterstadt(c);
    const made = c.store.submit(
      c.run('erfassen', anna, { vitalitaet: 'v2', geometrie: pt }, undefined, { clientTime: T1 }),
    );
    if (made.outcome !== 'accepted') throw new Error('refused');
    const id = made.observations.find((o) => o.property === '$created_by')?.featureId as FeatureId;
    expect(work(c.db, id)).toBe(T1);
    expect(audit(c.db, id)).toEqual({ created_at: T2, changed_at: T2 });
    c.db.close();
  });

  it('Monday work, Thursday sync: created and changed show Thursday, the work time stays Monday', () => {
    const { t, c } = clocked(THURSDAY);
    seedMusterstadt(c);
    const made = c.store.submit(
      c.run('erfassen', anna, { vitalitaet: 'v2', geometrie: pt }, undefined, { clientTime: MONDAY }),
    );
    if (made.outcome !== 'accepted') throw new Error('refused');
    const id = made.observations.find((o) => o.property === '$created_by')?.featureId as FeatureId;
    expect(audit(c.db, id)).toEqual({ created_at: THURSDAY, changed_at: THURSDAY });
    expect(work(c.db, id)).toBe(MONDAY);
    t.now = FRIDAY;
    const next = c.run('verschieben', vera, { geometrie: pt }, id, { clientTime: THURSDAY });
    expect(c.store.submit(next).outcome).toBe('accepted');
    expect(audit(c.db, id)).toEqual({ created_at: THURSDAY, changed_at: FRIDAY });
    c.db.close();
  });

  it('a rule run caused by an unstamped run inherits the stamped time', () => {
    const { c } = clocked(T1);
    seedMusterstadt(c);
    const r = c.store.submit(c.run('kontrolle', anna, { vitalitaet: 'v3', befund: 'Pilzbefall' }, IDS.t_in));
    if (r.outcome !== 'accepted') throw new Error('refused');
    const created = r.observations.find((o) => o.property === '$type' && o.result === 'massnahme');
    expect(audit(c.db, created?.featureId as string)).toEqual({ created_at: T1, changed_at: T1 });
    c.db.close();
  });
});

describe('a client cannot forge the work time (WP-762); the audit times are the receive time', () => {
  const createdAt = (c: ReturnType<typeof clocked>['c'], clientTime: string): { id: FeatureId } => {
    const made = c.store.submit(
      c.run('erfassen', anna, { vitalitaet: 'v2', geometrie: pt }, undefined, { clientTime }),
    );
    if (made.outcome !== 'accepted') throw new Error('refused');
    return { id: made.observations.find((o) => o.property === '$created_by')?.featureId as FeatureId };
  };

  it('a future client time is clamped to the server time plus the skew, for created_at and changed_at', () => {
    const { c } = clocked(T1);
    seedMusterstadt(c);
    const limit = new Date(Date.parse(T1) + AUDIT_CLOCK_SKEW_MS).toISOString();
    const { id } = createdAt(c, '2099-01-01T00:00:00.000Z');
    expect(work(c.db, id)).toBe(limit);
    expect(audit(c.db, id)).toEqual({ created_at: T1, changed_at: T1 });
    const later = c.run('verschieben', vera, { geometrie: pt }, id, {
      clientTime: '2099-06-01T00:00:00.000Z',
    });
    expect(c.store.submit(later).outcome).toBe('accepted');
    expect(audit(c.db, id)).toEqual({ created_at: T1, changed_at: T1 });
    c.db.close();
  });

  it('a time inside the skew is kept', () => {
    const { c } = clocked(T1);
    seedMusterstadt(c);
    const near = new Date(Date.parse(T1) + AUDIT_CLOCK_SKEW_MS - 1000).toISOString();
    const { id } = createdAt(c, near);
    expect(work(c.db, id)).toBe(near);
    c.db.close();
  });

  it('offline work that arrives days late keeps its past time', () => {
    const { c } = clocked(T2);
    seedMusterstadt(c);
    const week = new Date(Date.parse(T2) - 7 * 86_400_000).toISOString();
    const { id } = createdAt(c, week);
    expect(work(c.db, id)).toBe(week);
    c.db.close();
  });

  it('a time older than the offline bound is raised to the bound', () => {
    const { c } = clocked(T2);
    seedMusterstadt(c);
    const bound = new Date(Date.parse(T2) - AUDIT_MAX_OFFLINE_AGE_MS).toISOString();
    const { id } = createdAt(c, '1999-01-01T00:00:00.000Z');
    expect(work(c.db, id)).toBe(bound);
    c.db.close();
  });

  it('an unparseable client time becomes the server time', () => {
    const { c } = clocked(T2);
    seedMusterstadt(c);
    const { id } = createdAt(c, 'gestern');
    expect(work(c.db, id)).toBe(T2);
    c.db.close();
  });

  it('only participant runs are clamped: import and system runs keep their historical or future work times', () => {
    const old = '2019-03-04T08:00:00.000Z';
    const future = '2099-01-01T00:00:00.000Z';
    const { c } = clocked(T2);
    seedMusterstadt(c);
    const made = (kind: 'import' | 'participant', clientTime: string) => {
      const who = kind === 'participant' ? anna : actor(kind, `${kind}-1`, anna.roles);
      const r = c.store.submit(
        c.run('erfassen', who, { vitalitaet: 'v2', geometrie: pt }, undefined, { clientTime }),
      );
      if (r.outcome !== 'accepted') throw new Error(`refused ${kind}`);
      return r.observations.find((o) => o.property === '$created_by')?.featureId as FeatureId;
    };
    expect(work(c.db, made('import', old))).toBe(old);
    const bound = new Date(Date.parse(T2) - AUDIT_MAX_OFFLINE_AGE_MS).toISOString();
    expect(work(c.db, made('participant', old))).toBe(bound);
    // a system run (an automatic action) has no form: it writes through `then.set`, and its work time is kept
    const sys = {
      ...c.run('system_faellig', actor('system', 'system'), {}, IDS.t_in, { clientTime: future }),
      auto: 'system_faellig.kontrolle_wird_faellig' as Key,
    };
    expect(c.store.submit(sys).outcome).toBe('accepted');
    const stamped = c.db
      .prepare<{ phenomenon_time: string | null }>(
        `SELECT phenomenon_time FROM observations WHERE feature_id = ? AND property = 'kontrolle_faellig' ORDER BY rowid DESC`,
      )
      .get(IDS.t_in)?.phenomenon_time;
    expect(stamped).toBe(future);
    c.db.close();
  });
});
