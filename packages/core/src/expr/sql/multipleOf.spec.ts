/** `multiple_of` in SQLite (A-052, WP-483): `toSql` encodes it, and SQLite agrees with core on random values. */
import Database from 'better-sqlite3';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { check, T } from '../check';
import { isMultipleOf } from '../functions/numbers';
import { parse } from '../parse';
import { SQL_APP_FUNCTIONS, toSql } from '.';

const db = new Database(':memory:');
for (const f of SQL_APP_FUNCTIONS)
  db.function(f.name, { deterministic: true }, f.fn as (...a: unknown[]) => never);

function translate(src: string) {
  const p = parse(src);
  if (!p.ok) throw new Error(`parse ${src}`);
  const c = check(p.ast, { vars: { v: T.double, s: T.double }, features: {} });
  if (!c.ok) throw new Error(`check ${src}`);
  return toSql(c.typed, { self: 'f', other: 'o', vars: new Map() });
}

describe('multiple_of in SQL', () => {
  it('translates (no fallback to core) and runs', () => {
    const sql = translate('multiple_of(0.3, 0.1)');
    expect(sql.ok).toBe(true);
    if (!sql.ok) return;
    expect(db.prepare(`SELECT (${sql.sql}) AS v`).get(...sql.params)).toEqual({ v: 1 });
  });

  it('property: SQLite and core agree on random decimals and integers, negatives included', () => {
    const dec = fc
      .tuple(fc.integer({ min: -100000, max: 100000 }), fc.integer({ min: 0, max: 4 }))
      .map(([m, p]) => m / 10 ** p);
    const step = fc
      .tuple(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 0, max: 4 }))
      .map(([m, p]) => m / 10 ** p);
    const fn = db.prepare('SELECT ub_multiple_of(?, ?) AS v');
    fc.assert(
      fc.property(dec, step, fc.integer({ min: -50, max: 50 }), (v, s, n) => {
        for (const value of [v, Number((n * s).toFixed(6))])
          expect((fn.get(value, s) as { v: number }).v === 1).toBe(isMultipleOf(value, s));
      }),
      { numRuns: 500 },
    );
  });

  it('a bad step or a non-number gives null, which does not hold', () => {
    const fn = db.prepare('SELECT ub_multiple_of(?, ?) AS v');
    expect(fn.get(1, 0)).toEqual({ v: null });
    expect(fn.get('a', 1)).toEqual({ v: null });
  });
});
