// WP-306: `self.$lifecycle`, `self.$created_by`, `self.$created_at`, `self.$changed_at` in the rule language:
// the lexer allows `$` only after a `.`, the checker knows exactly the registry's names, evaluate and SQL agree.
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createGeo } from '../../geo';
import type { FeatureId, FeatureState, Json } from '../../model';
import { SYSTEM_FIELDS, readSystemField } from '../../registry/system-fields';
import { TemplateFileSchema } from '../../schema';
import { buildEnv, withVars } from '../../schema/compile/env';
import { check, type TypedAst } from '../check';
import type { EvalContext, FeatureAccess } from '../contract';
import { evaluate } from '../evaluate';
import { parse } from '../parse';
import { toSql } from '.';

const file = TemplateFileSchema.parse({
  schema: 'ueberblick/1',
  template: { key: 'sf', version: '1.0.0' },
  types: { baum: { label: 'Baum', properties: { name: { type: 'text' } } } },
});
const base = buildEnv(file);
const env = withVars(base, { self: base.feature('baum') }, false);

const NOW = '2026-05-01T08:00:00.000Z';
const rows: readonly FeatureState[] = [
  row('a', 'active', 'anna', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 1),
  row('b', 'completed', 'bernd', '2026-03-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', 2),
  row('c', 'active', undefined, undefined, undefined),
];
function row(
  id: string,
  lifecycle: FeatureState['lifecycle'],
  by: string | undefined,
  created: string | undefined,
  changed: string | undefined,
  pinned?: number,
): FeatureState {
  return {
    id: id as FeatureId,
    type: 'baum' as FeatureState['type'],
    properties: { name: id },
    lifecycle,
    updatedSeq: 1,
    ...(by === undefined ? {} : { createdBy: by }),
    ...(created === undefined ? {} : { createdAt: created }),
    ...(changed === undefined ? {} : { changedAt: changed }),
    ...(pinned === undefined ? {} : { pinnedVersion: pinned }),
  };
}

const typed = (src: string): TypedAst => {
  const p = parse(src);
  if (!p.ok) throw new Error(`parse: ${p.errors[0]?.message}`);
  const c = check(p.ast, env);
  if (!c.ok) throw new Error(`check: ${c.errors[0]?.message}`);
  return c.typed;
};

const access: FeatureAccess = {
  property: (id, key) => {
    const f = rows.find((r) => r.id === id);
    if (f === undefined) return undefined;
    return key.startsWith('$') ? readSystemField(f, key) : (f.properties[key] as Json | undefined);
  },
  related: () => [],
  history: () => [],
  type: () => 'baum' as FeatureState['type'],
};

const evalRow = (src: string, f: FeatureState): Json => {
  const ctx: EvalContext = {
    vars: new Map([['self', { $feature: f.id }]]),
    features: access,
    now: NOW,
    relations: new Map(),
    geo: createGeo(),
  };
  const r = evaluate(typed(src), ctx);
  if (!r.ok) throw new Error(r.error.message);
  return r.value as Json;
};

const db = new Database(':memory:');
db.exec(
  'CREATE TABLE features (id TEXT PRIMARY KEY, type TEXT, properties TEXT, lifecycle TEXT, created_by TEXT, created_at TEXT, changed_at TEXT, pinned_version INTEGER)',
);
for (const f of rows)
  db.prepare('INSERT INTO features VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    f.id,
    f.type,
    JSON.stringify(f.properties),
    f.lifecycle,
    f.createdBy ?? null,
    f.createdAt ?? null,
    f.changedAt ?? null,
    f.pinnedVersion ?? null,
  );

const sqlRows = (src: string): string[] => {
  const r = toSql(typed(src), { self: 'f', vars: new Map<string, Json>([['now', NOW]]) });
  if (!r.ok) throw new Error(r.unsupported.reason);
  return db
    .prepare(`SELECT f.id FROM features f WHERE ${r.sql} ORDER BY f.id`)
    .all(...(r.params as (string | number)[]))
    .map((x) => (x as { id: string }).id);
};
const evalRows = (src: string): string[] => rows.filter((f) => evalRow(src, f) === true).map((f) => f.id);

describe('system fields in the rule language', () => {
  it('the registry lists the five fields', () => {
    expect(SYSTEM_FIELDS.keys).toEqual(['lifecycle', 'created_by', 'created_at', 'changed_at', 'version']);
  });

  it('`$` starts a name only after a dot', () => {
    for (const bad of ['$lifecycle', "$created_by == 'x'", 'self.$', 'self . 1$a', 'a + $b', "'x'$y"]) {
      expect(parse(bad).ok, bad).toBe(false);
    }
    expect(parse('self.$lifecycle').ok).toBe(true);
    expect(parse('self.parent.$created_by == actor.id').ok).toBe(true);
  });

  it('an unknown self.$foo is a check problem; the four known names type-check', () => {
    const p = parse('self.$foo == 1');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const c = check(p.ast, env);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.errors[0]?.message).toContain("no property '$foo'");
    for (const ok of [
      "self.$lifecycle == 'completed'",
      'self.$created_by == actor.id',
      'self.$created_at < now',
      'self.$changed_at < now',
    ])
      expect(() => typed(ok.replace('actor.id', "'x'")), ok).not.toThrow();
    // the types are enforced: a creator is a string, no number
    const typeError = parse('self.$created_by < 3');
    expect(typeError.ok && check(typeError.ast, env).ok).toBe(false);
  });

  const SOURCES: readonly [string, string[]][] = [
    ["self.$lifecycle == 'completed'", ['b']],
    ["self.$lifecycle != 'completed'", ['a', 'c']],
    ["self.$created_by == 'anna'", ['a']],
    ["self.$created_by == 'anna' || self.$lifecycle == 'completed'", ['a', 'b']],
    ["self.$created_by in ['anna', 'bernd']", ['a', 'b']],
    ['self.$changed_at < now', ['a']],
    ['self.$created_at < now', ['a', 'b']],
    // A-029 (WP-315): `$version` is the column `pinned_version`; a floating feature (null) never matches a comparison.
    ['self.$version == 1', ['a']],
    ['self.$version >= 1', ['a', 'b']],
    ['self.$version == 3', []],
    ['!(self.$version == 1)', ['b', 'c']], // a null pin (floating, c) is selected by the negation, in SQL and in eval
    ['self.$version in [1, 2]', ['a', 'b']],
  ];
  it.each(SOURCES)('%s: evaluate and SQL agree', (src, ids) => {
    expect(evalRows(src)).toEqual(ids);
    expect(sqlRows(src)).toEqual(ids);
  });

  it('a feature without a creator reads null, so a comparison never matches it', () => {
    expect(evalRow("self.$created_by == 'anna'", rows[2] as FeatureState)).toBe(false);
    expect(sqlRows("self.$created_by == 'anna'")).not.toContain('c');
  });

  it('self.$version == n uses the partial index features_pinned (migration 18)', () => {
    // The DDL of project migration 18 (packages/server/src/db/project-schema.ts); core must not import the server.
    db.exec(
      'CREATE INDEX IF NOT EXISTS features_pinned ON features (pinned_version) WHERE pinned_version IS NOT NULL',
    );
    const r = toSql(typed('self.$version == 1'), { self: 'f', vars: new Map() });
    if (!r.ok) throw new Error('unsupported');
    console.info(`sql: ${r.sql} params: ${JSON.stringify(r.params)}`);
    expect(r.sql).toContain('f.pinned_version');
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN SELECT f.id FROM features f WHERE ${r.sql}`)
      .all(...(r.params as (string | number)[]))
      .map((x) => (x as { detail: string }).detail)
      .join(' ');
    console.info(`EXPLAIN QUERY PLAN self.$version == 1: ${plan}`);
    expect(plan).toContain('features_pinned');
  });

  it('"Nur eigene" uses the (type, created_by) index', () => {
    // The DDL of project migration 16 (packages/server/src/db/project-schema.ts); core must not import the server.
    // IF NOT EXISTS: the DB is shared by the tests of this file, so a repeat run finds the index in place.
    db.exec('CREATE INDEX IF NOT EXISTS features_by_creator ON features (type, created_by)');
    const r = toSql(typed("self.$created_by == 'anna'"), { self: 'f', vars: new Map() });
    if (!r.ok) throw new Error('unsupported');
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN SELECT f.id FROM features f WHERE f.type = ? AND ${r.sql}`)
      .all('baum', ...(r.params as (string | number)[]))
      .map((x) => (x as { detail: string }).detail)
      .join(' ');
    expect(plan).toContain('SEARCH f USING INDEX features_by_creator (type=? AND created_by=?)');
  });
});
