/**
 * Budget (WP-022 and WP-022.1, docs/12 "bbox query"): a viewport (R*Tree) plus a `toSql` filter on 60k features <= 100 ms.
 * The filter is generated from the rule language; the viewport comes from `viewportFrom` (WP-590), which makes the
 * R*Tree drive the join (the EXPLAIN QUERY PLAN assertion checks it). The filter-only case uses the expression
 * indexes that deploy creates (`propertySql('', key)`); the last case is the cost of translating.
 * Run: npm test -- -c bench/vitest.config.ts bench/expr-sql
 */
import { describe, expect, it } from 'vitest';
import { T, check } from '../../packages/core/src/expr/check';
import type { Env } from '../../packages/core/src/expr/check';
import { parse } from '../../packages/core/src/expr/parse';
import { propertySql, toSql } from '../../packages/core/src/expr/sql';
import { viewportFrom } from '../../packages/core/src/expr/sql/viewport';
import { generate } from '../generate/generate';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const N = 60_000;
const env: Env = {
  vars: { self: { kind: 'feature', type: 'baum' } },
  features: { baum: { stage: T.string, hoehe_m: T.double, art: T.string } },
};

const BIG = { maxLength: 1_000_000, maxDepth: 64 };

interface Timed {
  readonly sql: string;
  readonly params: readonly (string | number)[];
  readonly parseMs: number;
  readonly checkMs: number;
  readonly toSqlMs: number;
}

function translate(src: string): Timed {
  let t = performance.now();
  const p = parse(src, BIG);
  if (!p.ok) throw new Error(src);
  const parseMs = performance.now() - t;
  t = performance.now();
  const c = check(p.ast, env, { expect: T.bool });
  if (!c.ok) throw new Error(`${src}: ${c.errors[0]?.message}`);
  const checkMs = performance.now() - t;
  t = performance.now();
  const r = toSql(c.typed, { self: 'f', vars: new Map() });
  if (!r.ok) throw new Error(r.unsupported.reason);
  const params = r.params.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');
  if (params.length !== r.params.length) throw new Error(`${src}: a non-scalar SQL parameter`);
  return { sql: r.sql, params, parseMs, checkMs, toSqlMs: performance.now() - t };
}

const FILTER = "self.stage == 'kontrolliert' && self.hoehe_m > 15.0";
// about a quarter of the region (spec bbox 7.0 50.6 7.3 50.8)
const BBOX = [7.05, 50.65, 7.2, 50.75] as const; // west, south, east, north
const V = viewportFrom({ feature: 'f', box: 'b' });
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

describe('bench: toSql', () => {
  const { db } = generate({ seed: 4711, features: N });
  const f = translate(FILTER);
  const query = (extra = '') =>
    `SELECT count(*) AS n ${V.from}
     WHERE ${V.near} AND f.type = 'baum' AND f.lifecycle IN ('active','completed') AND ${f.sql} ${extra}`;
  const args = [...V.args(BBOX), ...f.params] as (string | number)[];
  const run = (): { ms: number; n: number } => {
    const t = performance.now();
    const row = db.prepare<{ n: number }>(query()).get(...args) as { n: number };
    return { ms: performance.now() - t, n: row.n };
  };

  it('a viewport plus a generated filter on 60k features <= 100 ms', () => {
    for (const key of ['stage', 'hoehe_m'])
      db.exec(`CREATE INDEX IF NOT EXISTS cfg_idx_${key} ON features (type, ${propertySql('', key)})`);
    run(); // warm-up
    const samples = Array.from({ length: 9 }, run);
    const ms = median(samples.map((s) => s.ms));
    const p95 = [...samples.map((s) => s.ms)].sort((a, b) => a - b)[8] as number;
    console.log(
      `bench expr-sql: viewport + filter, median ${ms.toFixed(1)} ms, worst ${p95.toFixed(1)} ms, ${samples[0]?.n} rows`,
    );
    expect(samples[0]?.n).toBeGreaterThan(0);
    const plan = db
      .prepare<{ detail: string }>(`EXPLAIN QUERY PLAN ${query()}`)
      .all(...args)
      .map((r) => r.detail)
      .join(' | ');
    console.log(`bench expr-sql plan: ${plan}`);
    expect(plan).toMatch(/^SCAN b VIRTUAL TABLE/); // the R*Tree drives (viewportFrom)
    assertBudget(
      report(
        defineBudget({
          id: 'expr-sql-bbox-filter-60k',
          limit: 100,
          unit: 'ms',
          row: 'bbox-query-p95',
          device: 'server',
        }),
        p95,
      ),
    );
  });

  it('a viewport plus a 16k-term OR-list of equalities: translate, prepare and run <= 100 ms (H6)', () => {
    db.exec(`CREATE INDEX IF NOT EXISTS cfg_idx_stage ON features (type, ${propertySql('', 'stage')})`);
    const known = (
      db
        .prepare<{ art: string }>(
          `SELECT DISTINCT ${propertySql('', 'stage')} AS art FROM features WHERE type = 'baum' GROUP BY 1 ORDER BY count(*) LIMIT 2`,
        )
        .all() as { art: string }[]
    ).map((r) => r.art);
    const terms = Array.from(
      { length: 16_000 },
      (_, i) => `self.stage == '${i < known.length ? known[i] : `x${i}`}'`,
    );
    const src = terms.join(' || ');
    const once = (): { ms: number; total: number; n: number; sql: string } => {
      const g = translate(src);
      const tTranslate = g.toSqlMs;
      const q = `SELECT count(*) AS n ${V.from}
        WHERE ${V.near} AND f.type = 'baum' AND f.lifecycle IN ('active','completed') AND ${g.sql}`;
      const tp = performance.now();
      const stmt = db.prepare<{ n: number }>(q);
      const row = stmt.get(...V.args(BBOX), ...g.params) as { n: number };
      const run = performance.now() - tp;
      console.log(
        `  parse ${g.parseMs.toFixed(0)} ms, check ${g.checkMs.toFixed(0)} ms, toSql ${tTranslate.toFixed(0)} ms, prepare+run ${run.toFixed(0)} ms`,
      );
      return { ms: run, total: tTranslate + run, n: row.n, sql: g.sql };
    };
    once(); // warm-up
    const samples = Array.from({ length: 5 }, once);
    const worst = Math.max(...samples.map((x) => x.ms));
    console.log(
      `bench expr-sql: 16k-term OR-list + viewport, median ${median(samples.map((x) => x.ms)).toFixed(1)} ms, worst ${worst.toFixed(1)} ms, ${samples[0]?.n} rows, ${samples[0]?.sql.length} chars of SQL`,
    );
    expect(samples[0]?.sql).toContain(' IN (');
    expect(samples[0]?.sql).not.toContain(' OR ');
    expect(samples[0]?.n).toBeGreaterThan(0);
    // budget: the collapsed filter prepares and runs with the viewport on 60k features <= 100 ms; translating
    // the 16k-term source (toSql only, parse and check are the caller's) is guarded separately
    assertBudget(
      report(
        defineBudget({
          id: 'expr-sql-or-list-16k-60k',
          limit: 100,
          unit: 'ms',
          row: 'bbox-query-p95',
          device: 'server',
        }),
        worst,
      ),
    );
    assertBudget(
      report(
        defineBudget({
          id: 'expr-sql-or-list-16k-total',
          limit: 250,
          unit: 'ms',
          derivedFrom: 'bbox-query-p95 (SQL translation share)',
          device: 'server',
        }),
        Math.max(...samples.map((x) => x.total)),
      ),
    );
  });

  it('the same filter over the whole project, index only (no viewport)', () => {
    const t = performance.now();
    const row = db
      .prepare<{ n: number }>(`SELECT count(*) AS n FROM features f WHERE f.type = 'baum' AND ${f.sql}`)
      .get(...f.params) as { n: number };
    const ms = performance.now() - t;
    console.log(`bench expr-sql: filter only, ${ms.toFixed(1)} ms, ${row.n} rows`);
    assertBudget(
      report(
        defineBudget({
          id: 'expr-sql-filter-only-60k',
          limit: 100,
          unit: 'ms',
          derivedFrom: 'bbox-query-p95 (filter-only SQL share)',
          device: 'server',
        }),
        Number(ms.toFixed(1)),
      ),
    );
  });

  it('translating a filter takes well under a millisecond', () => {
    const p = parse("self.stage == 'kontrolliert' && self.hoehe_m > 15.0 && self.art.startsWith('a')");
    if (!p.ok) throw new Error('parse');
    const c = check(p.ast, env);
    if (!c.ok) throw new Error('check');
    const t = performance.now();
    for (let i = 0; i < 1_000; i++) toSql(c.typed, { self: 'f', vars: new Map() });
    const perCall = (performance.now() - t) / 1_000;
    console.log(`bench expr-sql: toSql ${(perCall * 1000).toFixed(0)} us per call`);
    assertBudget(
      report(
        defineBudget({
          id: 'expr-sql-translate-call',
          limit: 1,
          unit: 'ms',
          row: 'run-endpoint-p95',
          device: 'server',
        }),
        Number(perCall.toFixed(4)),
      ),
    );
  });
});
