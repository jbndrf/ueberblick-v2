/** toSql: indexes, bound parameters, refusals, long chains and generated expressions, against real SQLite. */
import Database from 'better-sqlite3';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGeo } from '../../geo';
import type { Json } from '../../model';
import { PARSE_LIMITS } from '../ast';
import { ENV } from '../__fixtures__/check-cases';
import { evalContext } from '../__fixtures__/eval-cases';
import { WORLD_DDL, dataVars, worldStatements } from '../__fixtures__/sql-world';
import { T, check, type Env, type TypedAst } from '../check';
import { evaluate } from '../evaluate';
import { parse } from '../parse';
import { propertySql, toSql } from '.';

function typedIn(env: Env, src: string, limits?: Parameters<typeof parse>[1]): TypedAst {
  const p = parse(src, limits);
  if (!p.ok) throw new Error(`parse: ${p.errors[0]?.message}`);
  const c = check(p.ast, env);
  if (!c.ok) throw new Error(`check: ${c.errors[0]?.message}`);
  return c.typed;
}

const world = new Database(':memory:');
for (const ddl of WORLD_DDL) world.exec(ddl);
for (const [sql, params] of worldStatements()) world.prepare(sql).run(...params);
const MAPPING = { self: 'f', other: 'o', vars: dataVars() } as const;

describe('toSql: bound parameters only (H4)', () => {
  it('never puts a string from the source into the SQL text', () => {
    const evil = "x' OR 1=1 --";
    const r = toSql(typedIn(ENV, `self.art == "${evil}"`), MAPPING);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sql).not.toContain('OR 1=1');
    expect(r.params).toContain(evil);
    const rows = world.prepare(`SELECT id FROM features f WHERE ${r.sql}`).all(...r.params);
    expect(rows).toEqual([]);
  });

  it('refuses a property name that could leave the JSON path', () => {
    const r = toSql(typedIn(ENV, `self.meta["a'); DROP TABLE features;--"] == 1`), MAPPING);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.unsupported.reason).toContain('not a plain key');
    expect(world.prepare('SELECT count(*) AS n FROM features').get()).toEqual({ n: 5 });
  });

  it('takes values of actor, inputs and now from the mapping and binds them', () => {
    const r = toSql(typedIn(ENV, "'inspector' in actor.roles && self.art == inputs.name"), {
      ...MAPPING,
      vars: new Map([...dataVars(), ['inputs', { limit: 10, name: 'Linde' }]]),
    });
    expect(r.ok && r.params).toContain('Linde');
    expect(r.ok && r.sql).not.toContain('inspector');
  });
});

describe('toSql: constant spatial parts fold through the geometry port', () => {
  const src =
    "self.hoehe > 1.0 && distance({'type': 'Point', 'coordinates': [0.0, 0.0]}, {'type': 'Point', 'coordinates': [0.0, 1.0]}) > 111000.0";
  it('with a geo port the constant part becomes one bound value', () => {
    const r = toSql(typedIn(ENV, src), { ...MAPPING, geo: createGeo() });
    expect(r.ok).toBe(true);
  });
  it('without one it is refused', () => {
    expect(toSql(typedIn(ENV, src), MAPPING).ok).toBe(false);
  });
});

describe('toSql: refusals name the construct and its span', () => {
  it('spatial predicates are not translated', () => {
    const r = toSql(typedIn(ENV, 'intersects(self.geom, area.geom)'), MAPPING);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.unsupported.reason).toContain('intersects');
    expect(r.unsupported.span.start).toBe(0);
  });

  it('a nested refusal points at the offending sub-expression', () => {
    const src = "self.hoehe > 1 && size(last('stage', 5)) == 2";
    const r = toSql(typedIn(ENV, src), MAPPING);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(src.slice(r.unsupported.span.start, r.unsupported.span.end)).toBe("last('stage', 5)");
  });

  it('equality on a value that can fail is refused (null would turn into a plain false)', () => {
    for (const src of [
      'self.alter / self.alter == 1',
      'self.alter % (self.alter - 40) != 1',
      'self.meta.x + 1 == 2',
      '!(self.alter / (self.alter * 0) == 1)',
    ]) {
      const r = toSql(typedIn(ENV, src), MAPPING);
      expect(r.ok, src).toBe(false);
    }
    // a constant, non-zero divisor cannot fail
    expect(toSql(typedIn(ENV, 'self.alter / 3 == 1'), MAPPING).ok).toBe(true);
    // ordering propagates null like an error, so it is translated
    expect(toSql(typedIn(ENV, 'self.alter / self.alter > 1'), MAPPING).ok).toBe(true);
  });

  it('an unbound name is refused, not guessed', () => {
    const r = toSql(typedIn(ENV, "area.name == 'Park'"), MAPPING);
    expect(r.ok).toBe(false);
  });
});

describe('toSql: the generated filter uses the indexes (R14)', () => {
  const db = new Database(':memory:');
  db.exec(WORLD_DDL[0] as string);
  db.exec(`CREATE INDEX cfg_idx_hoehe ON features (type, ${propertySql('', 'hoehe')})`);
  db.exec(`CREATE INDEX cfg_idx_stage ON features (type, ${propertySql('', 'stage')})`);
  const plan = (sql: string, params: readonly Json[]) =>
    db
      .prepare<unknown[], { detail: string }>(
        `EXPLAIN QUERY PLAN SELECT id FROM features f WHERE f.type = ? AND ${sql}`,
      )
      .all('baum', ...(params as (string | number)[]))
      .map((r) => r.detail)
      .join(' | ');

  it.each([
    ['self.hoehe > 10.0', 'cfg_idx_hoehe'],
    ["self.stage == 'aktiv'", 'cfg_idx_stage'],
    ["self.stage == 'aktiv' && self.alter > 3", 'cfg_idx_stage'],
    ["self.stage in ['aktiv', 'neu']", 'cfg_idx_stage'],
    ['self.hoehe >= 3 && self.hoehe < 30', 'cfg_idx_hoehe'],
  ])('%s searches %s', (src, index) => {
    const r = toSql(typedIn(ENV, src), MAPPING);
    if (!r.ok) throw new Error(r.unsupported.reason);
    const p = plan(r.sql, r.params);
    expect(p).toContain('SEARCH');
    expect(p).toContain(index);
  });

  it('the index text is the property read of toSql (one definition)', () => {
    const r = toSql(typedIn(ENV, 'self.hoehe > 10.0'), MAPPING);
    expect(r.ok && r.sql).toContain(propertySql('f', 'hoehe'));
    expect(propertySql('', 'hoehe')).toBe("json_extract(properties, '$.hoehe')");
  });
});

describe('toSql: long flat chains (A-005 item 6)', () => {
  const chainEnv: Env = { ...ENV, features: { ...ENV.features, baum: { ...ENV.features.baum, a: T.int } } };
  const big = { maxLength: 1_000_000, maxDepth: PARSE_LIMITS.config.maxDepth };

  it('a 16k-term || chain translates (each value bound)', () => {
    const src = Array.from({ length: 16_000 }, (_, i) => `self.a == ${i}`).join(' || ');
    const r = toSql(typedIn(chainEnv, src, big), MAPPING);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params.length).toBe(16_000);
  });

  it('a long || chain is written as a balanced tree that SQLite accepts and runs (SQLite prepares 16k terms in about 4 s)', () => {
    const n = 2_000;
    const src = Array.from({ length: n }, (_, i) => `self.a == ${i}`).join(' || ');
    const r = toSql(typedIn(chainEnv, src, big), MAPPING);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.length).toBe(n);
    const db = new Database(':memory:');
    db.exec(WORLD_DDL[0] as string);
    db.prepare("INSERT INTO features (id, type, properties) VALUES ('x', 'baum', ?), ('y', 'baum', ?)").run(
      '{"a":1999}',
      '{"a":-1}',
    );
    const ids = db.prepare(`SELECT id FROM features f WHERE ${r.sql}`).all(...r.params);
    expect(ids).toEqual([{ id: 'x' }]);
  });

  it('a 16k-term && chain agrees with evaluate', () => {
    const src = Array.from({ length: 16_000 }, (_, i) => `self.a != ${i}`).join(' && ');
    const t = typedIn(chainEnv, src, big);
    expect(toSql(t, MAPPING).ok).toBe(true);
    const ok = evaluate(t, evalContext());
    expect(ok.ok).toBe(true);
  });

  it('a max-size constant chain (1+1+...) is folded without overflowing the stack', () => {
    const src = Array.from({ length: 16_000 }, () => '1').join('+');
    const r = toSql(typedIn(chainEnv, src, PARSE_LIMITS.config), MAPPING);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params).toEqual([16_000]);
  });

  it('an arithmetic chain on stored values beyond the SQLite depth limit is refused, not crashed', () => {
    const long = toSql(
      typedIn(chainEnv, Array.from({ length: 5_000 }, () => 'self.a').join('+'), big),
      MAPPING,
    );
    expect(long.ok).toBe(false);
    const ok = toSql(
      typedIn(chainEnv, Array.from({ length: 300 }, () => 'self.a').join('+') + ' > 0', big),
      MAPPING,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok)
      expect(() => world.prepare(`SELECT ${ok.sql} FROM features f`).all(...ok.params)).not.toThrow();
  });
});

describe('toSql: clipped by permissions (H4)', () => {
  it('a permission predicate and an assistant filter compose with AND and keep their parameters in order', () => {
    const perm = toSql(typedIn(ENV, "self.stage != 'erledigt'"), MAPPING);
    const filter = toSql(typedIn(ENV, 'self.hoehe > 10.0'), MAPPING);
    if (!perm.ok || !filter.ok) throw new Error('translate');
    const rows = world
      .prepare<unknown[], { id: string }>(
        `SELECT id FROM features f WHERE f.type = 'baum' AND (${perm.sql}) AND (${filter.sql})`,
      )
      .all(...perm.params, ...filter.params);
    expect(rows).toEqual([{ id: 'b1' }]);
  });
});

/* Generated expressions: numbers and logic over stored values agree with evaluate. */
const num = fc.memo((d: number): fc.Arbitrary<string> => {
  const leaf = fc.oneof(
    fc.constantFrom('self.alter', 'self.hoehe', '2', '7', '0', '-3', '2.5', '10.0'),
    fc.integer({ min: -20, max: 60 }).map((n) => String(n)),
  );
  if (d <= 0) return leaf;
  return fc.oneof(
    leaf,
    fc
      .tuple(num(d - 1), fc.constantFrom('+', '-', '*', '/'), num(d - 1))
      .map(([a, o, b]) => `(${a} ${o} ${b})`),
  );
});
const boolean = fc.memo((d: number): fc.Arbitrary<string> => {
  const cmp = fc
    .tuple(num(2), fc.constantFrom('<', '<=', '>', '>=', '==', '!='), num(2))
    .map(([a, o, b]) => `${a} ${o} ${b}`);
  if (d <= 0)
    return fc.oneof(cmp, fc.constantFrom('has(self.notiz)', 'has(self.hoehe)', 'self.notiz == null'));
  return fc.oneof(
    boolean(0),
    boolean(d - 1).map((a) => `!(${a})`),
    fc
      .tuple(boolean(d - 1), fc.constantFrom('&&', '||'), boolean(d - 1))
      .map(([a, o, b]) => `(${a}) ${o} (${b})`),
  );
});

describe('toSql: property test against evaluate', () => {
  it('generated conditions select the same rows', () => {
    fc.assert(
      fc.property(boolean(3), (src) => {
        const p = parse(src);
        if (!p.ok) return;
        const c = check(p.ast, ENV);
        if (!c.ok) return;
        const sql = toSql(c.typed, MAPPING);
        if (!sql.ok) return;
        for (const id of ['b1', 'b2']) {
          const row = world
            .prepare<unknown[], { v: number | null }>(
              `SELECT (${sql.sql}) AS v FROM features f WHERE f.id = ?`,
            )
            .get(...sql.params, id);
          const e = evaluate(c.typed, evalContext({ self: { $feature: id as never } }));
          expect(row?.v === 1, `${src} on ${id}`).toBe(e.ok && e.value === true);
        }
      }),
      { numRuns: 400 },
    );
  });
});
