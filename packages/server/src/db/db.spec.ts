import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACTOR_KINDS, CONFIG_VERSION_STATUSES, RUN_OUTCOMES } from '@ueberblick/core';
import { openSqlite, type Db } from './driver';
import { migrate, migrationState } from './migrate';
import { openControlDb, openProjectDb } from './open';
import { PROJECT_MIGRATIONS } from './project-schema';

const CONTROL_TABLES = [
  'previews',
  'projects',
  'accounts',
  'memberships',
  'credentials',
  'sessions',
  'templates',
];
const PROJECT_TABLES = [
  'config_versions',
  'participants',
  'runs',
  'observations',
  'features',
  'feature_bbox',
  'edges',
  'blobs',
  'outbox',
  'timers',
  'tombstones',
  'saved_views',
  'builder_draft',
  'erasure_runs',
  'prefs',
  'participant_columns',
];
const PROJECT_INDEXES = [
  'observations_by_feature',
  'edges_by_to',
  'features_by_seq',
  'edges_by_seq',
  'timers_by_due',
  'features_by_type',
];

const names = (db: Db, type: string): string[] =>
  db
    .prepare<{ name: string }>('SELECT name FROM sqlite_master WHERE type = ?')
    .all(type)
    .map((r) => r.name);

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ub-db-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('schema', () => {
  it('creates every control.db table', () => {
    const db = openControlDb(':memory:');
    expect(names(db, 'table')).toEqual(expect.arrayContaining(CONTROL_TABLES));
  });

  it('creates every project table and index', () => {
    const db = openProjectDb(':memory:', 'demo');
    expect(names(db, 'table')).toEqual(expect.arrayContaining(PROJECT_TABLES));
    expect(names(db, 'index')).toEqual(expect.arrayContaining(PROJECT_INDEXES));
  });
});

describe('sync indexes (migration 4)', () => {
  it('are created by the migration, not by the sync service', () => {
    const db = openSqlite(':memory:');
    migrate(
      db,
      PROJECT_MIGRATIONS.filter((m) => m.id < 4),
    );
    expect(names(db, 'index')).not.toContain('features_by_seq');
    const later = PROJECT_MIGRATIONS.filter((m) => m.id >= 4).map((m) => m.id);
    expect(migrationState(db, PROJECT_MIGRATIONS).pending).toEqual(later);
    expect(migrate(db, PROJECT_MIGRATIONS)).toEqual(later);
    expect(names(db, 'index')).toEqual(expect.arrayContaining(['features_by_seq', 'edges_by_seq']));
    expect(PROJECT_MIGRATIONS.find((m) => m.id === 4)?.name).toBe('sync_indexes');
  });

  it('the sync read path uses them', () => {
    const db = openProjectDb(':memory:', 'demo');
    const plan = (sql: string): string =>
      db
        .prepare<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
        .all()
        .map((r) => r.detail)
        .join(' ');
    expect(plan('SELECT id FROM features WHERE updated_seq > 5 ORDER BY updated_seq')).toContain(
      'features_by_seq',
    );
    expect(plan('SELECT from_id FROM edges WHERE updated_seq > 5')).toContain('edges_by_seq');
    // the timers tick (WP-108): the due rows come from an index, not from a scan of the table
    expect(
      plan("SELECT feature_id FROM timers WHERE due_at <= 'x' ORDER BY due_at, feature_id, rule LIMIT 5"),
    ).toContain('timers_by_due');
  });

  it('no service creates an index outside a migration (R11)', () => {
    const src = readFileSync(fileURLToPath(new URL('../sync/service.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/CREATE INDEX/i);
  });
});

describe('features_by_type (migration 10)', () => {
  it('is created by the migration, not before it', () => {
    const db = openSqlite(':memory:');
    migrate(
      db,
      PROJECT_MIGRATIONS.filter((m) => m.id < 10),
    );
    expect(names(db, 'index')).not.toContain('features_by_type');
    const later = PROJECT_MIGRATIONS.filter((m) => m.id >= 10).map((m) => m.id);
    expect(migrationState(db, PROJECT_MIGRATIONS).pending).toEqual(later);
    expect(migrate(db, PROJECT_MIGRATIONS)).toEqual(later);
    expect(names(db, 'index')).toContain('features_by_type');
    expect(PROJECT_MIGRATIONS.find((m) => m.id === 10)?.name).toBe('features_by_type');
  });

  it('the ofType read uses it', () => {
    const db = openProjectDb(':memory:', 'demo');
    const plan = (sql: string, ...params: (string | number)[]): string =>
      db
        .prepare<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...params)
        .map((r) => r.detail)
        .join(' ');
    // the statement of `Facts.ofType` (store/facts/facts.ts), matched on the index name only
    expect(
      plan(
        "SELECT id, type, properties, updated_seq, lifecycle FROM features WHERE type = ? AND lifecycle IN ('active','completed') ORDER BY id",
        'baum',
      ),
    ).toContain('features_by_type');
  });
});

describe('features.pinned_version (migration 18, A-029)', () => {
  const planOf = (db: Db, sql: string, ...params: (string | number)[]): string =>
    db
      .prepare<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...params)
      .map((r) => r.detail)
      .join(' ');

  it('adds the column and the partial index', () => {
    const db = openProjectDb(':memory:', 'demo');
    expect(
      db
        .prepare<{ name: string }>("SELECT name FROM pragma_table_info('features')")
        .all()
        .map((c) => c.name),
    ).toContain('pinned_version');
    const idx = db
      .prepare<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'features_pinned'")
      .get();
    expect(idx?.sql).toContain('WHERE pinned_version IS NOT NULL');
    expect(PROJECT_MIGRATIONS.find((m) => m.id === 18)?.name).toBe('features_pinned_version');
  });

  it('back-fills the pin from the newest $version observation; a null result and a feature without one stay null', () => {
    const db = openSqlite(':memory:');
    migrate(
      db,
      PROJECT_MIGRATIONS.filter((m) => m.id < 18),
    );
    db.prepare(
      `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome)
       VALUES ('r', 'u', 'admin', 't', 1, '{}', 'x', 'accepted')`,
    ).run();
    const feature = db.prepare(
      `INSERT INTO features (id, type, config_version, properties, updated_seq) VALUES (?, 'baum', 1, '{}', 1)`,
    );
    const obs = db.prepare(
      "INSERT INTO observations (seq, run_id, feature_id, property, result) VALUES (?, 'r', ?, '$version', ?)",
    );
    for (const id of ['pinned', 'repinned', 'unpinned', 'floating']) feature.run(id);
    obs.run(1, 'pinned', '1');
    obs.run(2, 'repinned', '1');
    obs.run(3, 'repinned', '3');
    obs.run(4, 'unpinned', '2');
    obs.run(5, 'unpinned', 'null');
    expect(
      migrate(
        db,
        PROJECT_MIGRATIONS.filter((m) => m.id <= 18),
      ),
    ).toEqual([18]);
    const pins = Object.fromEntries(
      db
        .prepare<{ id: string; pinned_version: number | null }>('SELECT id, pinned_version FROM features')
        .all()
        .map((r) => [r.id, r.pinned_version]),
    );
    expect(pins).toEqual({ pinned: 1, repinned: 3, unpinned: null, floating: null });
  });

  it('self.$version == n and the live-set read use the partial index (EXPLAIN QUERY PLAN)', () => {
    const db = openProjectDb(':memory:', 'demo');
    const eq = planOf(db, 'SELECT f.id FROM features f WHERE f.pinned_version = ?', 2);
    console.info(`EXPLAIN QUERY PLAN pinned_version = ?: ${eq}`);
    expect(eq).toContain('features_pinned');
    const live = planOf(db, 'SELECT DISTINCT pinned_version FROM features WHERE pinned_version IS NOT NULL');
    console.info(`EXPLAIN QUERY PLAN live set: ${live}`);
    expect(live).toContain('features_pinned');
  });
});

describe('migrate', () => {
  it('is idempotent and ordered', () => {
    const db = openSqlite(':memory:');
    const ms = [
      { id: 1, name: 'a', sql: 'CREATE TABLE a (x)' },
      { id: 2, name: 'b', sql: 'CREATE TABLE b (x)' },
    ];
    expect(migrate(db, ms)).toEqual([1, 2]);
    expect(migrate(db, ms)).toEqual([]);
    expect(migrate(db, [...ms, { id: 3, name: 'c', sql: 'CREATE TABLE c (x)' }])).toEqual([3]);
    expect(() => migrate(db, [...ms].reverse())).toThrow(/increasing/);
  });

  it('migrationState reads pending and unknown ids without writing anything', () => {
    const db = openSqlite(':memory:');
    const ms = [
      { id: 1, name: 'a', sql: 'CREATE TABLE a (x)' },
      { id: 2, name: 'b', sql: 'CREATE TABLE b (x)' },
    ];
    expect(migrationState(db, ms)).toEqual({ pending: [1, 2], unknown: [] });
    expect(names(db, 'table')).toEqual([]);
    migrate(db, ms.slice(0, 1));
    expect(migrationState(db, ms)).toEqual({ pending: [2], unknown: [] });
    expect(migrationState(db, ms.slice(0, 0))).toEqual({ pending: [], unknown: [1] });
    expect(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({ n: 1 });
  });

  it('a failing migration leaves no trace', () => {
    const db = openSqlite(':memory:');
    expect(() =>
      migrate(db, [{ id: 1, name: 'bad', sql: 'CREATE TABLE a (x); CREATE TABLE a (x)' }]),
    ).toThrow();
    expect(names(db, 'table')).not.toContain('a');
    expect(db.prepare('SELECT id FROM schema_migrations').all()).toEqual([]);
  });

  it('second open of a project file is a no-op', () => {
    const dir = tmp();
    openProjectDb(dir, 'demo').close();
    const db = openProjectDb(dir, 'demo');
    expect(db.prepare<{ n: number }>('SELECT count(*) n FROM schema_migrations').get()?.n).toBe(
      PROJECT_MIGRATIONS.length,
    );
  });
});

describe('pragmas and extensions', () => {
  it('sets WAL, foreign keys and busy timeout on a file db', () => {
    const db = openProjectDb(tmp(), 'demo');
    const p = (name: string): unknown => Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0];
    expect(p('journal_mode')).toBe('wal');
    expect(p('foreign_keys')).toBe(1);
    expect(p('busy_timeout')).toBe(5000);
    expect(p('synchronous')).toBe(1);
  });

  it('has R*Tree and JSON1', () => {
    const db = openProjectDb(':memory:', 'demo');
    db.prepare('INSERT INTO feature_bbox VALUES (1, 0, 2, 0, 2)').run();
    const hit = db.prepare('SELECT rid FROM feature_bbox WHERE minx <= 1 AND maxx >= 1').all();
    expect(hit).toEqual([{ rid: 1 }]);
    expect(db.prepare<{ v: string }>('SELECT json_extract(\'{"a":"x"}\', \'$.a\') v').get()?.v).toBe('x');
  });

  it('enforces foreign keys', () => {
    const db = openProjectDb(':memory:', 'demo');
    expect(() =>
      db.prepare("INSERT INTO observations (run_id, feature_id, property) VALUES ('nope','f','p')").run(),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('CHECK constraints come from the registries', () => {
  const run = (db: Db, kind: string, outcome: string) =>
    db
      .prepare(
        "INSERT INTO runs (id, actor, actor_kind, task, config_version, input, received_at, outcome) VALUES (?, 'a', ?, 't', 1, '{}', 'now', ?)",
      )
      .run(`r${Math.random()}`, kind, outcome);

  it('accepts exactly the registry keys', () => {
    const db = openProjectDb(':memory:', 'demo');
    for (const k of ACTOR_KINDS.keys) expect(() => run(db, k, 'accepted')).not.toThrow();
    for (const o of RUN_OUTCOMES.keys) expect(() => run(db, 'admin', o)).not.toThrow();
    expect(() => run(db, 'robot', 'accepted')).toThrow(/CHECK/);
    expect(() => run(db, 'admin', 'maybe')).toThrow(/CHECK/);
  });

  it('config version status', () => {
    const db = openProjectDb(':memory:', 'demo');
    const ins = db.prepare(
      "INSERT INTO config_versions (schema, overlay, compiled, hash, status, created_at) VALUES ('1','{}','{}', ?, ?, 'now')",
    );
    CONFIG_VERSION_STATUSES.keys.forEach((s, i) => expect(() => ins.run(`h${i}`, s)).not.toThrow());
    expect(() => ins.run('hx', 'bogus')).toThrow(/CHECK/);
  });
});

describe('transaction', () => {
  it('rolls back on throw and commits on return', () => {
    const db = openProjectDb(':memory:', 'demo');
    const count = () => db.prepare<{ n: number }>('SELECT count(*) n FROM blobs').get()?.n;
    const add = (id: string) => db.prepare("INSERT INTO blobs VALUES (?, 'x', 1, 'now')").run(id);
    expect(() =>
      db.transaction(() => {
        add('a');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(count()).toBe(0);
    expect(db.transaction(() => (add('b'), 7))).toBe(7);
    expect(count()).toBe(1);
  });
});

describe('project keys and files', () => {
  it('rejects invalid keys', () => {
    for (const k of ['', 'A', '1a', 'a-b', '../x', 'a/b', 'a.b', 'a__b', 'a__vorschau'])
      expect(() => openProjectDb(tmp(), k)).toThrow(/invalid project key/);
  });

  it('keeps every project file in one directory', () => {
    const dir = tmp();
    openProjectDb(dir, 'one').close();
    openProjectDb(dir, 'two_2').close();
    openControlDb(join(dir, 'control.db')).close();
    const files = readdirSync(dir).filter((f) => f.endsWith('.db'));
    expect(files.sort()).toEqual(['control.db', 'project-one.db', 'project-two_2.db']);
  });
});

describe('features_lifecycle (migration 11)', () => {
  it('turns deleted rows into lifecycle deleted, keeps the rest active and rebuilds the index', () => {
    const db = openSqlite(':memory:');
    migrate(
      db,
      PROJECT_MIGRATIONS.filter((m) => m.id < 11),
    );
    const ins = db.prepare(
      "INSERT INTO features (id, type, config_version, properties, updated_seq, deleted) VALUES (?, 't', 1, '{}', 1, ?)",
    );
    ins.run('live', 0);
    ins.run('gone', 1);
    expect(migrate(db, PROJECT_MIGRATIONS)).toEqual(
      PROJECT_MIGRATIONS.filter((m) => m.id >= 11).map((m) => m.id),
    );
    const rows = db
      .prepare<{ id: string; lifecycle: string }>('SELECT id, lifecycle FROM features ORDER BY id')
      .all();
    expect(rows).toEqual([
      { id: 'gone', lifecycle: 'deleted' },
      { id: 'live', lifecycle: 'active' },
    ]);
    expect(names(db, 'index')).toContain('features_by_type');
    expect(PROJECT_MIGRATIONS.find((m) => m.id === 11)?.name).toBe('features_lifecycle');
  });
});

describe('deploy_moves (migration 12)', () => {
  it('is created by the migration, not before it', () => {
    const db = openSqlite(':memory:');
    migrate(
      db,
      PROJECT_MIGRATIONS.filter((m) => m.id < 12),
    );
    expect(names(db, 'table')).not.toContain('deploy_moves');
    expect(migrate(db, PROJECT_MIGRATIONS)).toContain(12);
    expect(names(db, 'table')).toContain('deploy_moves');
    expect(PROJECT_MIGRATIONS.find((m) => m.id === 12)?.name).toBe('deploy_moves');
  });
});
