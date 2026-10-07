import { describe, expect, it } from 'vitest';
import { openSqlite, type Db } from './driver';
import { migrate } from './migrate';
import { PROJECT_MIGRATIONS } from './project-schema';

describe('timers.config_version (migration 20, WP-318, A-029)', () => {
  const insert = (db: Db, id: string): void => {
    db.prepare(
      "INSERT INTO timers (feature_id, rule, due_at) VALUES (?, 'r', '2026-01-01T00:00:00.000Z')",
    ).run(id);
  };
  const versions = (db: Db): (number | null)[] =>
    db
      .prepare<{ config_version: number | null }>('SELECT config_version FROM timers ORDER BY feature_id')
      .all()
      .map((r) => r.config_version);

  it('back-fills the deployed version into the existing rows, and is idempotent', () => {
    const db = openSqlite(':memory:');
    migrate(
      db,
      PROJECT_MIGRATIONS.filter((m) => m.id < 20),
    );
    db.prepare(
      `INSERT INTO config_versions (version, schema, overlay, compiled, hash, status, created_at)
       VALUES (3, 'ueberblick/1', '{}', '{}', 'h', 'deployed', 'x')`,
    ).run();
    insert(db, 'a');
    insert(db, 'b');
    expect(migrate(db, PROJECT_MIGRATIONS)).toContain(20);
    expect(versions(db)).toEqual([3, 3]);
    expect(migrate(db, PROJECT_MIGRATIONS)).toEqual([]);
    expect(versions(db)).toEqual([3, 3]);
    expect(PROJECT_MIGRATIONS.find((m) => m.id === 20)?.name).toBe('timers_config_version');
  });

  it('leaves the column null where nothing is deployed yet (the first tick reschedules it)', () => {
    const db = openSqlite(':memory:');
    migrate(
      db,
      PROJECT_MIGRATIONS.filter((m) => m.id < 20),
    );
    insert(db, 'a');
    migrate(db, PROJECT_MIGRATIONS);
    expect(versions(db)).toEqual([null]);
  });
});
