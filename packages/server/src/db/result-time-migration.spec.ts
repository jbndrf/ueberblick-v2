// WP-794: migration 26 gives `observations` the O&M result_time, back-filled from the run, and recomputes the audit times.
import { describe, expect, it } from 'vitest';
import { openSqlite, type Db } from './driver';
import { migrate } from './migrate';
import { PROJECT_MIGRATIONS } from './project-schema';

const RECEIVED = '2026-03-05T14:30:00.000Z';
const WORK = '2026-03-02T09:00:00.000Z';
const HISTORIC = '2019-04-01T08:00:00.000Z';

function run(db: Db, id: string, kind: string, client: string): void {
  db.prepare(
    `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, client_time, received_at, outcome)
     VALUES (?, 'a', ?, 't', 1, '{}', ?, ?, 'accepted')`,
  ).run(id, kind, client, RECEIVED);
}
const obs = (db: Db, seq: number, runId: string, feature: string, property: string): void => {
  db.prepare(
    'INSERT INTO observations (seq, run_id, feature_id, property, result, phenomenon_time) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(seq, runId, feature, property, '"x"', WORK);
};

describe('observations.result_time (migration 26)', () => {
  it('back-fills the receive time, an import run keeps its historical time, and the audit columns follow', () => {
    const db = openSqlite(':memory:');
    migrate(
      db,
      PROJECT_MIGRATIONS.filter((m) => m.id < 26),
    );
    run(db, 'p', 'participant', WORK);
    run(db, 'i', 'import', HISTORIC);
    obs(db, 1, 'p', 'f1', '$type');
    obs(db, 2, 'i', 'f2', '$type');
    for (const id of ['f1', 'f2'])
      db.prepare(
        `INSERT INTO features (id, type, config_version, properties, lifecycle, created_at, changed_at, updated_seq)
         VALUES (?, 't', 1, '{}', 'active', ?, ?, 1)`,
      ).run(id, WORK, WORK);
    expect(migrate(db, PROJECT_MIGRATIONS)).toContain(26);
    const times = db
      .prepare<{ seq: number; result_time: string }>('SELECT seq, result_time FROM observations ORDER BY seq')
      .all();
    expect(times).toEqual([
      { seq: 1, result_time: RECEIVED },
      { seq: 2, result_time: HISTORIC },
    ]);
    const audit = db
      .prepare<{ id: string; created_at: string; changed_at: string }>(
        'SELECT id, created_at, changed_at FROM features ORDER BY id',
      )
      .all();
    expect(audit).toEqual([
      { id: 'f1', created_at: RECEIVED, changed_at: RECEIVED },
      { id: 'f2', created_at: HISTORIC, changed_at: HISTORIC },
    ]);
    expect(migrate(db, PROJECT_MIGRATIONS)).toEqual([]);
  });

  it('keeps observations append-only, including result_time', () => {
    const db = openSqlite(':memory:');
    migrate(db, PROJECT_MIGRATIONS);
    run(db, 'p', 'participant', WORK);
    obs(db, 1, 'p', 'f1', '$type');
    expect(() => db.prepare("UPDATE observations SET result_time = 'x' WHERE seq = 1").run()).toThrow(
      /append-only/,
    );
  });
});
