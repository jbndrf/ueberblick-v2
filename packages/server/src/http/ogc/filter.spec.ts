/**
 * The filter pipeline, with a stand-in for the CQL2 seam: rule-language text instead of CQL2 text, and a hand-made
 * check environment. What is proved is the split (SQL terms, residual terms, bbox bound); the CQL2 reading itself is
 * core's (`fromCql2`, WP-109) and is wired when core exports it.
 */
import { describe, expect, it } from 'vitest';
import { createGeo } from '@ueberblick/core';
import { check, parse, T } from '@ueberblick/core/expr/compile';
import { golden, IDS, seedMusterstadt } from '../../store/run/testkit';
import { syncSetup } from '../../sync/testkit';
import { conjuncts, planFilter } from './filter';
import { readPage } from './items';
import type { Cql2Seam } from './seams';

const env = {
  vars: { self: { kind: 'feature', type: 'baum' } as const },
  features: { baum: { vitalitaet: T.string, geometrie: T.geometry, hoehe_m: T.double } },
};
const seam: Cql2Seam = {
  read(_config, _type, filter) {
    const p = parse(String(filter));
    if (!p.ok) return { ok: false, message: p.errors[0]?.message ?? 'parse' };
    const c = check(p.ast, env);
    return c.ok ? { ok: true, typed: c.typed } : { ok: false, message: c.errors[0]?.message ?? 'check' };
  },
};

function setup() {
  const config = golden('musterstadt-plain');
  const ctx = syncSetup(config);
  seedMusterstadt(ctx);
  const facts = ctx.store.access(1);
  if (facts === undefined) throw new Error('no facts');
  const fenv = {
    cql2: seam,
    config,
    geo: createGeo(),
    now: '2026-05-01T08:00:00.000Z' as never,
    features: facts,
  };
  const vis = ctx.service.visible({ id: 'x', kind: 'admin', roles: ['verwaltung' as never] }, 'f');
  const ids = (filter: string, bbox?: [number, number, number, number]) => {
    const r = planFilter(fenv, 'baum', filter, 'cql2-text', bbox);
    if (!r.ok) return r.message;
    const page = readPage(ctx.db, {
      type: 'baum',
      visible: vis,
      limit: 10,
      after: 0,
      ...(bbox ? { bbox } : {}),
      filter: r.plan,
    });
    return page.ok ? page.page.rows.map((x) => x.id).sort() : page.message;
  };
  return { ids, fenv };
}
const sorted = (...x: string[]): string[] => x.sort();
const POLY =
  "{'type':'Polygon','coordinates':[[[7.09,50.72],[7.11,50.72],[7.11,50.74],[7.09,50.74],[7.09,50.72]]]}";

describe('planFilter', () => {
  it('flattens top-level AND terms without recursion', () => {
    const p = parse('a == 1 && b == 2 && c == 3');
    if (!p.ok) throw new Error('parse');
    expect(conjuncts(p.ast)).toHaveLength(3);
  });

  it('a translatable term goes into the WHERE', () => {
    const { ids } = setup();
    expect(ids("self.vitalitaet == 'v2'")).toEqual([IDS.t_in]);
  });

  it('multiple_of runs in SQL: a WHERE, no residual, no bbox needed', () => {
    const { fenv } = setup();
    const r = planFilter(fenv, 'baum', 'multiple_of(self.hoehe_m, 0.5)', 'cql2-text', undefined);
    expect(r.ok ? '' : r.message).toBe('');
    expect(r.ok && r.plan.where).toBeDefined();
    expect(r.ok && r.plan.residual).toBeUndefined();
  });

  it('a spatial term is a residual bounded by the bbox of its geometry', () => {
    const { ids, fenv } = setup();
    expect(ids(`intersects(self.geometrie, ${POLY})`)).toEqual(sorted(IDS.t_in, IDS.t_hole));
    const r = planFilter(fenv, 'baum', `intersects(self.geometrie, ${POLY})`, 'cql2-text', undefined);
    expect(r.ok && r.plan.bbox).toEqual([7.09, 50.72, 7.11, 50.74]);
  });

  it('SQL and spatial terms combine', () => {
    const { ids } = setup();
    expect(ids(`self.vitalitaet == 'v1' && intersects(self.geometrie, ${POLY})`)).toEqual([IDS.t_hole]);
  });

  it('a residual without any bbox is refused, never evaluated over all features', () => {
    const { ids } = setup();
    expect(ids(`disjoint(self.geometrie, ${POLY})`)).toMatch(/bbox/);
    expect(ids(`disjoint(self.geometrie, ${POLY})`, [7.0, 50.0, 7.2, 51.0])).toEqual([IDS.t_out]);
  });

  it('dwithin widens the bbox by the distance', () => {
    const { fenv } = setup();
    const r = planFilter(
      fenv,
      'baum',
      "dwithin(self.geometrie, {'type':'Point','coordinates':[7.0,50.0]}, 1000)",
      'cql2-text',
      undefined,
    );
    expect(r.ok && r.plan.bbox?.[0]).toBeLessThan(7.0);
  });

  it('a filter the seam rejects is a message', () => {
    const { fenv } = setup();
    expect(planFilter(fenv, 'baum', 'self.nope ==', 'cql2-text', undefined)).toMatchObject({ ok: false });
  });
});
