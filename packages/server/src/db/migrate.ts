import type { Db } from './driver';

/** One forward-only schema step. `id` is unique and strictly increasing per database. */
export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

/** Applies pending migrations in id order, each in one IMMEDIATE transaction that re-checks the step, so it is safe across processes. A second run is a no-op. Returns the ids this call applied. */
export function migrate(db: Db, migrations: readonly Migration[]): number[] {
  const ids = migrations.map((m) => m.id);
  if (ids.some((id, i) => i > 0 && id <= (ids[i - 1] as number))) {
    throw new Error('migrations must have strictly increasing ids');
  }
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const applied: number[] = [];
  for (const m of migrations) {
    // The write lock is taken at BEGIN and the check is repeated inside it: another process may have applied this
    // step since we looked (two connections opening one file), and a second CREATE TABLE would throw.
    db.transaction(
      () => {
        const has = db
          .prepare<{ n: number }>('SELECT count(*) AS n FROM schema_migrations WHERE id = ?')
          .get(m.id);
        if (has?.n) return;
        db.exec(m.sql);
        db.prepare(
          "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        ).run(m.id, m.name);
        applied.push(m.id);
      },
      { immediate: true },
    );
  }
  return applied;
}

/**
 * Read-only check: which migration ids are pending (known, not applied) and which are unknown (applied, not known,
 * e.g. the database is newer than this server). Never creates or changes anything.
 */
export function migrationState(
  db: Pick<Db, 'prepare'>,
  migrations: readonly Migration[],
): { pending: number[]; unknown: number[] } {
  const hasTable = db
    .prepare<{ n: number }>(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .get();
  const applied = hasTable?.n
    ? db
        .prepare<{ id: number }>('SELECT id FROM schema_migrations ORDER BY id')
        .all()
        .map((r) => r.id)
    : [];
  const known = migrations.map((m) => m.id);
  return {
    pending: known.filter((id) => !applied.includes(id)),
    unknown: applied.filter((id) => !known.includes(id)),
  };
}
