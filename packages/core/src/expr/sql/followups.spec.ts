/**
 * WP-022.1: OR-lists collapse to IN, Unicode lower/upper and calendar months run through registered application
 * functions, inverse relations come from the compiled config. Every case is checked against `evaluate` over
 * the same data in a real SQLite (parity, docs/06).
 */
import Database from 'better-sqlite3';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { createGeo } from '../../geo';
import type { FeatureId, Json, Key } from '../../model';
import { TemplateFileSchema } from '../../schema/file';
import { compile, sqlInverse } from '../../schema/compile';
import { fromCql2 } from '../cql2';
import { T, check, type Env, type TypedAst } from '../check';
import type { EvalContext } from '../contract';
import { evaluate } from '../evaluate';
import { parse } from '../parse';
import { SQL_APP_FUNCTIONS, toSql, type SqlMapping } from '.';
import { goldenAssets } from '../../testing/golden';

interface Row {
  readonly type: string;
  readonly properties: Record<string, Json>;
  /** Outgoing edges, relation key to target ids (as stored: `edges.from_id`, `relation`, `to_id`). */
  readonly edges?: Record<string, string[]>;
}

/** A tiny world in SQLite (with the application functions registered) and the same world for `evaluate`. */
function world(rows: Record<string, Row>, related: (id: string, relation: string) => string[]) {
  const db = new Database(':memory:');
  for (const f of SQL_APP_FUNCTIONS)
    db.function(f.name, { deterministic: true }, f.fn as (...a: unknown[]) => never);
  db.exec(
    "CREATE TABLE features (id TEXT PRIMARY KEY, type TEXT, properties TEXT, lifecycle TEXT DEFAULT 'active')",
  );
  db.exec('CREATE TABLE edges (from_id TEXT, relation TEXT, to_id TEXT)');
  for (const [id, r] of Object.entries(rows)) {
    db.prepare('INSERT INTO features (id, type, properties) VALUES (?, ?, ?)').run(
      id,
      r.type,
      JSON.stringify(r.properties),
    );
    for (const [rel, to] of Object.entries(r.edges ?? {}))
      for (const t of to) db.prepare('INSERT INTO edges VALUES (?, ?, ?)').run(id, rel, t);
  }
  const ctx = (self: string): EvalContext => ({
    vars: new Map<string, Json | { $feature: FeatureId }>([
      ['self', { $feature: self as FeatureId }],
      ['now', '2026-09-29T10:00:00.000Z'],
    ]),
    features: {
      property: (id, k) => rows[id]?.properties[k],
      related: (id, rel) => related(id, rel) as FeatureId[],
      history: () => [],
      type: (id) => rows[id]?.type as Key | undefined,
    },
    now: '2026-09-29T10:00:00.000Z',
    relations: new Map([
      ['flaeche' as Key, new Set(['baeume' as Key])],
      ['baum' as Key, new Set(['flaeche' as Key])],
    ]),
    geo: createGeo(),
  });
  return { db, ctx };
}

function typed(env: Env, src: string): TypedAst {
  const p = parse(src);
  if (!p.ok) throw new Error(`parse ${src}`);
  const c = check(p.ast, env);
  if (!c.ok) throw new Error(`check ${src}: ${c.errors[0]?.message}`);
  return c.typed;
}

const ENV: Env = {
  vars: { self: { kind: 'feature', type: 'baum' }, now: T.timestamp },
  features: { baum: { art: T.string, hoehe: T.double, alter: T.int, datum: T.timestamp, n: T.int } },
};
const NO_VARS: SqlMapping = { self: 'f', vars: new Map([['now', '2026-09-29T10:00:00.000Z']]) };

/** The ids for which the SQL filter holds, and those for which evaluate says true. */
function holds(w: ReturnType<typeof world>, t: TypedAst, mapping: SqlMapping, ids: string[]) {
  const sql = toSql(t, mapping);
  if (!sql.ok) throw new Error(`unsupported: ${sql.unsupported.reason}`);
  const viaSql = (
    w.db.prepare(`SELECT f.id AS id FROM features f WHERE ${sql.sql} ORDER BY f.id`).all(...sql.params) as {
      id: string;
    }[]
  )
    .map((r) => r.id)
    .filter((id) => ids.includes(id));
  const viaEval = ids.filter((id) => {
    const r = evaluate(t, w.ctx(id));
    return r.ok && r.value === true;
  });
  return { viaSql, viaEval, sql };
}

const baum = (properties: Record<string, Json>): Row => ({ type: 'baum', properties });

describe('OR-lists collapse to IN (H6)', () => {
  const rows = {
    b1: baum({ art: 'Linde', n: 1 }),
    b2: baum({ art: 'Eiche', n: 2 }),
    b3: baum({ art: 'Buche', n: 3 }),
    b4: baum({ n: 4 }),
    b5: baum({ art: 'Ahorn', n: 5 }),
  };
  const ids = Object.keys(rows);
  const w = world(rows, () => []);

  it('x == c1 || x == c2 || x == c3 is one IN with bound values', () => {
    const t = typed(ENV, "self.art == 'Linde' || self.art == 'Eiche' || self.art == 'Ahorn'");
    const { viaSql, viaEval, sql } = holds(w, t, NO_VARS, ids);
    expect(sql.sql).toContain(' IN (?, ?, ?)');
    expect(sql.sql).not.toContain(' OR ');
    expect(sql.params).toEqual(['Linde', 'Eiche', 'Ahorn']);
    expect(viaSql).toEqual(viaEval);
    expect(viaSql).toEqual(['b1', 'b2', 'b5']);
  });

  it('other terms stay; equal left sides group even when not adjacent; a single term stays an equality', () => {
    const t = typed(ENV, "self.art == 'Linde' || self.n == 3 || self.art == 'Eiche' || self.n > 4");
    const { viaSql, viaEval, sql } = holds(w, t, NO_VARS, ids);
    expect(sql.sql.match(/ IN \(/g)).toHaveLength(1);
    expect(viaSql).toEqual(viaEval);
    const single = holds(w, typed(ENV, "self.art == 'Linde' || self.n > 4"), NO_VARS, ids);
    expect(single.sql.sql).not.toContain(' IN (');
    expect(single.viaSql).toEqual(single.viaEval);
  });

  it('a missing value is never in the list, also under negation (== never gives null)', () => {
    const t = typed(ENV, "!(self.art == 'Linde' || self.art == 'Eiche')");
    const { viaSql, viaEval } = holds(w, t, NO_VARS, ids);
    expect(viaSql).toEqual(viaEval);
    expect(viaSql).toContain('b4');
  });

  it('numbers collapse too, and mixing integers and doubles keeps parity', () => {
    const t = typed(ENV, 'self.n == 1 || self.n == 2 || self.n == 5');
    const { viaSql, viaEval, sql } = holds(w, t, NO_VARS, ids);
    expect(sql.sql).toContain(' IN (');
    expect(viaSql).toEqual(viaEval);
  });

  it('a CQL2 IN list and a CQL2 OR chain give the same IN', () => {
    for (const text of [
      "art IN ('Linde', 'Eiche', 'Ahorn')",
      "art = 'Linde' OR art = 'Eiche' OR art = 'Ahorn'",
    ]) {
      const p = fromCql2(text);
      if (!p.ok) throw new Error(text);
      const c = check(p.ast, ENV);
      if (!c.ok) throw new Error(`${text}: ${c.errors[0]?.message}`);
      const { viaSql, viaEval, sql } = holds(w, c.typed, NO_VARS, ids);
      expect(sql.sql).toContain(' IN (?, ?, ?)');
      expect(viaSql).toEqual(viaEval);
      expect(viaSql).toEqual(['b1', 'b2', 'b5']);
    }
  });

  it('a 16k-term OR-list becomes one IN with 16k bound values and runs', () => {
    const src = Array.from({ length: 16_000 }, (_, i) => `self.art == 'x${i}'`).join(' || ');
    const p = parse(src, { maxLength: 1_000_000, maxDepth: 64 });
    if (!p.ok) throw new Error('parse');
    const c = check(p.ast, ENV);
    if (!c.ok) throw new Error('check');
    const r = toSql(c.typed, NO_VARS);
    if (!r.ok) throw new Error(r.unsupported.reason);
    expect(r.sql.match(/ IN \(/g)).toHaveLength(1);
    expect(r.params).toHaveLength(16_000);
    expect(w.db.prepare(`SELECT count(*) AS n FROM features f WHERE ${r.sql}`).get(...r.params)).toEqual({
      n: 0,
    });
  });

  it('property: any OR-list of equalities selects what evaluate selects', () => {
    const arts = fc.constantFrom('Linde', 'Eiche', 'Buche', 'Ahorn', 'Birke');
    fc.assert(
      fc.property(fc.array(arts, { minLength: 1, maxLength: 8 }), fc.boolean(), (list, negate) => {
        const body = list.map((a) => `self.art == '${a}'`).join(' || ');
        const t = typed(ENV, negate ? `!(${body})` : body);
        const { viaSql, viaEval } = holds(w, t, NO_VARS, ids);
        expect(viaSql).toEqual(viaEval);
      }),
      { numRuns: 60 },
    );
  });
});

describe('lower and upper use the registered Unicode functions', () => {
  const samples = ['Ärger', 'straße', 'İstanbul', 'ΣΊΣΥΦΟΣ', 'Ǆ', 'ÉCOLE', 'plain', 'ÖÄÜ ß', '日本語'];
  const rows = Object.fromEntries(samples.map((s, i) => [`b${i}`, baum({ art: s, n: i })]));
  const w = world(rows, () => []);
  const ids = Object.keys(rows);

  it.each([
    ["self.art.lower() == 'ärger'"],
    ["self.art.upper() == 'STRASSE'"],
    ["self.art.lower() == 'i̇stanbul'"],
    ["self.art.lower() == 'σίσυφοσ'"],
    ["self.art.upper() == 'ÖÄÜ SS'"],
    ["self.art.lower().startsWith('é')"],
    ["!(self.art.upper() == 'PLAIN')"],
  ])('%s', (src) => {
    const { viaSql, viaEval } = holds(w, typed(ENV, src), NO_VARS, ids);
    expect(viaSql).toEqual(viaEval);
  });

  it('holds for at least one non-ASCII row (the test is not vacuous)', () => {
    const { viaSql } = holds(w, typed(ENV, "self.art.upper() == 'STRASSE'"), NO_VARS, ids);
    expect(viaSql).toEqual(['b1']);
  });

  it('as a value, both backends give the same text for any string', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 12 }), (s) => {
        const t = typed(ENV, 'self.art.lower() + self.art.upper()');
        const sql = toSql(t, NO_VARS);
        if (!sql.ok) throw new Error('unsupported');
        w.db.prepare("UPDATE features SET properties = ? WHERE id = 'b0'").run(JSON.stringify({ art: s }));
        const row = w.db.prepare(`SELECT (${sql.sql}) AS v FROM features f WHERE f.id = 'b0'`).get() as {
          v: string | null;
        };
        const r = evaluate(t, world({ b0: baum({ art: s }) }, () => []).ctx('b0'));
        expect(row.v).toBe(r.ok ? r.value : null);
      }),
      { numRuns: 60 },
    );
  });
});

describe('date + months(n) clamps to the end of the month like evaluate', () => {
  const dates = [
    '2026-01-31T00:00:00.000Z',
    '2028-01-31T00:00:00.000Z',
    '2028-02-29T12:30:00.000Z',
    '2026-03-31T23:59:59.999Z',
    '2026-10-31T00:00:00.000Z',
    '2026-12-15T08:00:00.000Z',
    '2024-02-29T00:00:00.000Z',
  ];
  const ns = [0, 1, -1, 2, 12, -12, 13, 48, -25];
  const rows = Object.fromEntries(
    dates.flatMap((d, i) => ns.map((n, j) => [`b${i}_${j}`, baum({ datum: d, n })] as const)),
  );
  const w = world(rows, () => []);
  const ids = Object.keys(rows);

  it.each([
    ["self.datum + months(1) > date('2026-12-31')"],
    ["self.datum - months(1) < date('2026-02-01')"],
    ['self.datum + months(self.n) > now'],
    ['self.datum - months(self.n) < now'],
    ["self.datum + months(12) == date('2029-02-28')"],
    ["self.datum + months(1) + days(3) > date('2027-01-01')"],
    ["self.datum + months(1) == date('2026-02-28')"],
    ["self.datum + months(1) == date('2028-02-29')"],
  ])('%s', (src) => {
    const { viaSql, viaEval } = holds(w, typed(ENV, src), NO_VARS, ids);
    expect(viaSql).toEqual(viaEval);
  });

  it('the exact clamped values match (leap years, month ends)', () => {
    for (const src of ['self.datum + months(self.n)', 'self.datum - months(self.n)']) {
      const t = typed(ENV, src);
      const sql = toSql(t, NO_VARS);
      if (!sql.ok) throw new Error('unsupported');
      for (const id of ids) {
        const got = (
          w.db.prepare(`SELECT (${sql.sql}) AS v FROM features f WHERE f.id = ?`).get(...sql.params, id) as {
            v: string;
          }
        ).v;
        const want = evaluate(t, w.ctx(id));
        expect(got, `${src} on ${id}`).toBe(want.ok ? want.value : null);
      }
    }
  });

  it('months() elsewhere still has no SQL, with a reason', () => {
    const r = toSql(typed(ENV, "self.datum + (months(1) + days(2)) > date('2027-01-01')"), NO_VARS);
    expect(r.ok).toBe(false);
  });
});

describe('inverse relations come from the compiled config', () => {
  const raw = import.meta.glob('../../schema/compile/__fixtures__/base.yaml', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const file = parseYaml(Object.values(raw)[0] as string) as Record<string, unknown>;
  const types = file['types'] as Record<string, Record<string, unknown>>;
  types['flaeche'] = {
    ...types['flaeche'],
    relations: { baeume: { to: 'baum', inverse_of: 'baum.flaeche' } },
  };
  const compiled = compile(TemplateFileSchema.parse(file), { assets: goldenAssets });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
  const config = compiled.config;

  it('sqlInverse reads the relation key from inverse_of, per type', () => {
    expect([...sqlInverse(config)]).toEqual([['flaeche.baeume', 'flaeche']]);
    expect(sqlInverse(config)).toBe(sqlInverse(config));
  });

  // baum -> flaeche edges are stored under 'flaeche'; the flaeche reads them backwards as 'baeume'
  const rows: Record<string, Row> = {
    f1: { type: 'flaeche', properties: { name: 'Park' } },
    f2: { type: 'flaeche', properties: { name: 'Wald' } },
    f3: { type: 'flaeche', properties: { name: 'Leer' } },
    b1: { type: 'baum', properties: { stage: 'erfasst' }, edges: { flaeche: ['f1'] } },
    b2: { type: 'baum', properties: { stage: 'erledigt' }, edges: { flaeche: ['f1'] } },
    b3: { type: 'baum', properties: { stage: 'erledigt' }, edges: { flaeche: ['f2'] } },
  };
  const related = (id: string, rel: string): string[] =>
    rel === 'baeume'
      ? Object.entries(rows)
          .filter(([, r]) => r.edges?.['flaeche']?.includes(id))
          .map(([b]) => b)
      : (rows[id]?.edges?.[rel] ?? []);
  const w = world(rows, related);
  const env = (compiled.ok &&
    compiled.config && {
      vars: { self: { kind: 'feature', type: 'flaeche' } },
      features: {
        flaeche: { name: T.string, baeume: { kind: 'list', element: { kind: 'feature', type: 'baum' } } },
        baum: { stage: T.string },
      },
    }) as Env;
  const mapping: SqlMapping = { self: 'f', vars: new Map(), inverse: sqlInverse(config) };

  it.each([
    ["self.baeume.exists(b, b.stage == 'erfasst')"],
    ["self.baeume.all(b, b.stage == 'erledigt')"],
    ['size(self.baeume) == 2'],
    ["size(self.baeume.filter(b, b.stage == 'erledigt')) >= 1"],
    ['has(self.baeume)'],
  ])('%s', (src) => {
    const ids = ['f1', 'f2', 'f3'];
    const { viaSql, viaEval } = holds(w, typed(env, src), mapping, ids);
    expect(viaSql).toEqual(viaEval);
  });

  it('without the mapping the relation would be read forwards and find nothing', () => {
    const t = typed(env, 'size(self.baeume) == 2');
    const plain = holds(w, t, { self: 'f', vars: new Map() }, ['f1']);
    expect(plain.viaSql).toEqual([]);
    expect(plain.viaEval).toEqual(['f1']);
  });
});
