/**
 * Parity (docs/06): every corpus case runs through `evaluate` and through `toSql` against a real SQLite, and
 * both must agree. Cases that `toSql` reports as unsupported are listed with their reason, so a regression
 * that silently drops SQL support fails the coverage floor below.
 */
import Database from 'better-sqlite3';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Json } from '../../model';
import { ENV } from '../__fixtures__/check-cases';
import {
  EVAL_ABSORB,
  EVAL_DYN_ERR,
  EVAL_ERR,
  EVAL_NULL,
  EVAL_OK,
  evalContext,
} from '../__fixtures__/eval-cases';
import { SQL_ONLY_CASES } from '../__fixtures__/sql-cases';
import { WORLD_DDL, dataVars, worldStatements } from '../__fixtures__/sql-world';
import { check, type TypedAst } from '../check';
import { evaluate } from '../evaluate';
import { parse } from '../parse';
import { SQL_APP_FUNCTIONS, toSql } from '.';

const db = new Database(':memory:');
for (const f of SQL_APP_FUNCTIONS)
  db.function(f.name, { deterministic: true }, f.fn as (...a: unknown[]) => never);
beforeAll(() => {
  for (const ddl of WORLD_DDL) db.exec(ddl);
  for (const [sql, params] of worldStatements()) db.prepare(sql).run(...params);
});

function typed(src: string): TypedAst {
  const p = parse(src);
  if (!p.ok) throw new Error(`parse ${src}`);
  const c = check(p.ast, ENV);
  if (!c.ok) throw new Error(`check ${src}: ${c.errors.map((e) => e.message).join('; ')}`);
  return c.typed;
}

const SIDES = [
  ['b1', 'b2'],
  ['b2', 'b1'],
] as const;

const unsupportedReasons = new Map<string, string>();
let supported = 0;

/** Runs one source for one (self, other) pair and compares; returns false when toSql has no encoding. */
function agree(src: string, self: string, other: string): boolean {
  const t = typed(src);
  const sql = toSql(t, { self: 'f', other: 'o', vars: dataVars() });
  if (!sql.ok) {
    unsupportedReasons.set(src, sql.unsupported.reason);
    return false;
  }
  for (const p of sql.params) expect(['string', 'number']).toContain(typeof p);
  const row = db
    .prepare<unknown[], { v: string | number | null }>(
      `SELECT (${sql.sql}) AS v FROM features f, features o WHERE f.id = ? AND o.id = ?`,
    )
    .get(...sql.params, self, other);
  const expected = evaluate(
    t,
    evalContext({ self: { $feature: self as never }, other: { $feature: other as never } }),
  );
  const actual = row?.v ?? null;
  if (t.type.kind === 'bool') {
    // a WHERE clause cannot tell false from null, and neither can a condition: compare "holds"
    expect(actual === 1, `${src} [self ${self}]`).toBe(expected.ok && expected.value === true);
    return true;
  }
  if (!expected.ok) return true; // an error has no SQL counterpart; a bool error is checked above
  const v = expected.value as Json;
  if (v !== null && typeof v === 'object') return true; // lists and maps are not SQL values
  expect(actual, `${src} [self ${self}]`).toEqual(v);
  supported++;
  return true;
}

describe('parity: evaluate and toSql agree on the corpus', () => {
  const all: readonly (readonly [string])[] = [
    ...EVAL_OK.map(([s]) => [s] as const),
    ...EVAL_NULL.map((s) => [s] as const),
    ...EVAL_ABSORB.map(([s]) => [s] as const),
    ...EVAL_ERR.map(([s]) => [s] as const),
    ...EVAL_DYN_ERR.map(([s]) => [s] as const),
    ...SQL_ONLY_CASES.map((s) => [s] as const),
  ];
  it.each(all)('%s', (src) => {
    for (const [self, other] of SIDES) agree(src, self, other);
  });

  it('most of the corpus has a SQL encoding; the rest is named, with a reason', () => {
    const total = all.length;
    const missing = unsupportedReasons.size;
    console.log(`toSql: ${total - missing}/${total} corpus sources translated`);
    for (const [src, reason] of unsupportedReasons) console.log(`  unsupported: ${src}  -> ${reason}`);
    expect(total - missing).toBeGreaterThan(total * 0.55);
    expect(supported).toBeGreaterThan(100);
  });
});
