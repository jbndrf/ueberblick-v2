/**
 * `Facts.related` must equal what core's SQL translation of the same relation returns from the same database
 * (expr/sql/values.ts relationFrom/through). Membership is tested per candidate with
 * `self.<rel>.exists(x, x.code == inputs.name)` (many) or `self.<rel>.code == inputs.name` (to-one),
 * where `code` is each feature's own id, so the two can not drift.
 */
import { T, check, listOf, parse, type Env, type Ty } from '@ueberblick/core/expr/compile';
import { toSql } from '@ueberblick/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createFacts } from './index';
import { IDS, INVERSE, SQL_INVERSE, Model, fid, ingest, k, op, toLog, openDb } from './sqlite.testkit';

const feature = (type: string): Ty => ({ kind: 'feature', type });
const props = { code: T.string, name: T.string };
const ENV = (self: string): Env => ({
  vars: { self: feature(self), inputs: { kind: 'record', fields: { name: T.string } } },
  features: {
    tree: { ...props, plot: feature('plot'), area_of: listOf(feature('area')) },
    plot: { ...props, trees: listOf(feature('tree')) },
    area: { ...props, trees: listOf(feature('tree')) },
  },
});

const CASES: readonly (readonly [string, string, string])[] = [
  ['tree', 'plot', 'self.plot.code == inputs.name'],
  ['tree', 'area_of', 'self.area_of.exists(x, x.code == inputs.name)'],
  ['plot', 'trees', 'self.trees.exists(x, x.code == inputs.name)'],
  ['area', 'trees', 'self.trees.exists(x, x.code == inputs.name)'],
];

function typed(self: string, src: string) {
  const p = parse(src);
  if (!p.ok) throw new Error(p.errors[0]?.message);
  const c = check(p.ast, ENV(self));
  if (!c.ok) throw new Error(c.errors[0]?.message);
  return c.typed;
}

function sqlFor(type: string, src: string, candidate: string) {
  const r = toSql(typed(type, src), {
    self: 'f',
    inverse: SQL_INVERSE,
    vars: new Map([['inputs', { name: candidate }]]),
  });
  if (!r.ok) throw new Error(r.unsupported.reason);
  return r;
}

describe('related equals core relation SQL', () => {
  it('for every feature, relation and candidate of random worlds', () => {
    const compiled = CASES.map(([type, rel, src]) => ({
      type,
      rel,
      byCandidate: new Map(IDS.map((c) => [c, sqlFor(type, src, c)])),
    }));
    fc.assert(
      fc.property(fc.array(op, { maxLength: 50 }), (ops) => {
        const db = openDb();
        ingest(db, new Model(), toLog(ops), 7);
        const facts = createFacts(db, INVERSE);
        for (const { type, rel, byCandidate } of compiled) {
          const selves = db.prepare<{ id: string }>('SELECT id FROM features WHERE type = ?').all(type);
          for (const { id } of selves) {
            const viaFacts = new Set(facts.related(fid(id), k(rel)));
            for (const [candidate, r] of byCandidate) {
              const hit = db
                .prepare(`SELECT 1 AS hit FROM features f WHERE f.id = ? AND (${r.sql})`)
                .get(id, ...(r.params as never[]));
              expect(hit !== undefined, `${id}.${rel} ~ ${candidate}`).toBe(viaFacts.has(fid(candidate)));
            }
          }
        }
        db.close();
      }),
      { numRuns: 40 },
    );
  });
});
