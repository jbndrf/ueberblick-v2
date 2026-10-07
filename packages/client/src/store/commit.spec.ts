import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { edge, feature, fid, key, obs } from './test-env';
import { SLICE_ROWS, sliceNotice, type CommitNotice } from './commit';
import { edgeKey } from '@ueberblick/core/fold';
import { toRecorded } from './plan';

const cursor = { kind: 'delta', cursor: 9, scopeFingerprint: 's' } as const;

/** `features` features; each has `edgesPer` edges from it and `historyPer` history rows; feature 1 gets `extraHistory` more. */
function notice(features: number, historyPer: number, edgesPer = 1, extraHistory = 0): CommitNotice {
  const ids = Array.from({ length: features }, (_, i) => i + 1);
  return {
    from: undefined,
    commit: {
      kind: 'page',
      cursor,
      plan: {
        featurePuts: ids.map((n) => feature(n, 1)),
        featureDeletes: [fid(999_999)],
        edgePuts: ids.flatMap((n) => Array.from({ length: edgesPer }, (_, k) => edge(n, `r${k}`, n + 1, 1))),
        edgeDeletes: [edgeKey({ from: fid(999_999), relation: key('r'), to: fid(1) })],
        runPuts: [],
        peoplePuts: [],
        historyPuts: ids.flatMap((n) =>
          Array.from({ length: historyPer + (n === 1 ? extraHistory : 0) }, (_, i) =>
            toRecorded(obs(n, 'h', i + 1)),
          ),
        ),
      },
    },
  };
}

const plansOf = (slices: readonly CommitNotice[]) =>
  slices.map((s) => {
    if (s.commit.kind !== 'page') throw new Error('a page notice stays a page notice');
    return s.commit.plan;
  });

describe('sliceNotice', () => {
  it('a small page stays one notice without a part; only apply-rows are kept', () => {
    const out = sliceNotice(notice(10, 1));
    expect(out).toHaveLength(1);
    expect(out[0]?.part).toBeUndefined();
    expect(Object.keys((out[0]?.commit as { plan: object }).plan).sort()).toEqual([
      'edgeDeletes',
      'edgePuts',
      'featureDeletes',
      'featurePuts',
      'historyPuts',
      'peoplePuts',
      'runPuts',
    ]);
  });

  it('other commits are never split', () => {
    const n: CommitNotice = { from: cursor, commit: { kind: 'cleared' } };
    expect(sliceNotice(n)).toEqual([n]);
  });

  it('a feature travels with its edges and history rows in one slice', () => {
    const slices = plansOf(sliceNotice(notice(500, 3, 2), 40));
    expect(slices.length).toBeGreaterThan(10);
    for (const p of slices) {
      const own = new Set(p.featurePuts.map((f) => f.id));
      // every edge and history row sits beside its feature, and every feature brings all of its own
      for (const e of p.edgePuts) expect(own.has(e.from)).toBe(true);
      for (const h of p.historyPuts) expect(own.has(h.featureId)).toBe(true);
      for (const f of p.featurePuts) {
        expect(p.edgePuts.filter((e) => e.from === f.id)).toHaveLength(2);
        expect(p.historyPuts.filter((h) => h.featureId === f.id)).toHaveLength(3);
      }
    }
  });

  it('an oversized single group is one slice and is never split', () => {
    const slices = plansOf(sliceNotice(notice(3, 1, 1, 2000)));
    const big = slices.filter((p) => p.historyPuts.length > SLICE_ROWS);
    expect(big).toHaveLength(1);
    expect(big[0]?.featurePuts.map((f) => f.id)).toEqual([fid(1)]);
    expect(big[0]?.historyPuts).toHaveLength(2001);
  });

  it('property: slices partition every row once, keep groups whole and stay under the cap unless one group is bigger', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 800 }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 900 }),
        (f, h, e, extra) => {
          const n = notice(f, h, e, extra);
          const slices = sliceNotice(n);
          slices.forEach((s, i) => {
            if (slices.length > 1) expect(s.part).toEqual({ index: i, count: slices.length });
            expect(s.from).toBe(n.from);
          });
          const plans = plansOf(slices);
          expect(plans.flatMap((p) => p.featurePuts)).toHaveLength(f);
          expect(plans.flatMap((p) => p.edgePuts)).toHaveLength(f * e);
          expect(plans.flatMap((p) => p.historyPuts)).toHaveLength(f * h + (f > 0 ? extra : 0));
          expect(plans.flatMap((p) => p.featureDeletes)).toHaveLength(1);
          expect(plans.flatMap((p) => p.edgeDeletes)).toHaveLength(1);
          for (const p of plans) {
            const own = new Set(p.featurePuts.map((x) => x.id));
            for (const x of p.edgePuts) expect(own.has(x.from)).toBe(true);
            for (const x of p.historyPuts) expect(own.has(x.featureId)).toBe(true);
            const rowsIn = p.featurePuts.length + p.edgePuts.length + p.historyPuts.length;
            if (p.featurePuts.length > 1) expect(rowsIn).toBeLessThanOrEqual(SLICE_ROWS);
          }
        },
      ),
    );
  });
});
