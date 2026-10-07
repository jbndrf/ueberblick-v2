import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ClusterIndex } from './index-core';
import type { ClusterPoint } from './protocol';

const WORLD = [-180, -90, 180, 90] as const;
const grid = (n: number): ClusterPoint[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, lng: (i % 100) / 10, lat: Math.floor(i / 100) / 10 }));
const total = (index: ClusterIndex, zoom = 3): number =>
  index.query(WORLD, zoom).reduce((n, i) => n + (i.count ?? 1), 0);

describe('ClusterIndex: bounded rebuilds', () => {
  it('builds once for repeated queries', () => {
    const index = new ClusterIndex();
    index.apply(grid(2000), [], []);
    index.query(WORLD, 3);
    index.query(WORLD, 4);
    expect(index.builds).toBe(1);
  });

  it('a one-feature update in place does not rebuild the index; a move rebuilds once (WP-706)', () => {
    const index = new ClusterIndex();
    index.apply(grid(2000), [], []);
    index.query(WORLD, 3);
    index.apply([], [{ id: 'p5', lng: 0.5, lat: 0 }], []);
    index.query(WORLD, 3);
    expect(index.builds).toBe(1);
    index.apply([], [{ id: 'p5', lng: 50, lat: 50 }], []);
    const items = index.query(WORLD, 3);
    expect(index.builds).toBe(2);
    const p5 = index.query(WORLD, 20).find((i) => i.featureId === 'p5');
    expect(p5?.lng).toBeCloseTo(50, 6);
    expect(items.length).toBeGreaterThan(0);
  });

  it('a one-feature add shows up without a rebuild, a remove rebuilds once (WP-706)', () => {
    const index = new ClusterIndex();
    index.apply(grid(2000), [], []);
    index.query(WORLD, 20);
    index.apply([{ id: 'new', lng: 60, lat: 60 }], [], ['p1']);
    const items = index.query(WORLD, 20);
    expect(index.builds).toBe(2);
    expect(items.some((i) => i.featureId === 'new')).toBe(true);
    expect(items.some((i) => i.featureId === 'p1')).toBe(false);
    expect(items).toHaveLength(2000);
  });

  it('a moved feature is not drawn twice at high zoom', () => {
    const index = new ClusterIndex();
    index.apply(grid(500), [], []);
    index.query(WORLD, 20);
    index.apply([], [{ id: 'p3', lng: 70, lat: 70 }], []);
    const items = index.query(WORLD, 20);
    expect(items.filter((i) => i.featureId === 'p3')).toHaveLength(1);
  });

  it('rebuilds once accumulated changes pass the bound, and is exact afterwards', () => {
    const index = new ClusterIndex();
    index.apply(grid(2000), [], []);
    index.query(WORLD, 3);
    const many = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, lng: 80 + i / 100, lat: 80 }));
    index.apply(many, [], []);
    expect(total(index)).toBe(2300);
    expect(index.builds).toBe(2);
  });

  it('a change before the first query does not add a build', () => {
    const index = new ClusterIndex();
    index.apply(grid(100), [], []);
    index.apply([{ id: 'x', lng: 1, lat: 1 }], [], []);
    expect(total(index)).toBe(101);
    expect(index.builds).toBe(1);
  });
});

const op = fc.oneof(
  fc.record({
    kind: fc.constant('add' as const),
    n: fc.nat(60),
    lng: fc.double({ min: 0, max: 20, noNaN: true }),
    lat: fc.double({ min: 0, max: 20, noNaN: true }),
  }),
  fc.record({
    kind: fc.constant('update' as const),
    n: fc.nat(60),
    lng: fc.double({ min: 0, max: 20, noNaN: true }),
    lat: fc.double({ min: 0, max: 20, noNaN: true }),
  }),
  fc.record({ kind: fc.constant('remove' as const), n: fc.nat(60) }),
);

const key = (i: { featureId?: string; lng: number; lat: number }): string =>
  `${i.featureId ?? ''}@${i.lng.toFixed(9)},${i.lat.toFixed(9)}`;
const singles = (index: ClusterIndex, zoom: number) =>
  index
    .query(WORLD, zoom)
    .filter((i) => i.featureId !== undefined)
    .map(key)
    .sort();

describe('ClusterIndex: rebuilds per change (WP-735 regression)', () => {
  it('add x, remove x, add x: one id, two rebuilds after the first build (the shrunk counterexample)', () => {
    const index = new ClusterIndex();
    index.apply(grid(200), [], []);
    index.query(WORLD, 3);
    const x = { id: 'x1', lng: 5, lat: 5 };
    index.apply([x], [], []);
    index.query(WORLD, 22);
    expect(index.builds).toBe(1); // a single add keeps the overlay
    index.apply([], [], ['x1']);
    index.query(WORLD, 22);
    index.apply([x], [], []); // re-add of a removed id rebuilds
    index.query(WORLD, 22);
    expect(index.builds).toBe(3);
  });
});

describe('ClusterIndex: single adds never rebuild (WP-735, R14)', () => {
  it('ten single adds of fresh ids, each queried: still one build', () => {
    const index = new ClusterIndex();
    index.apply(grid(200), [], []);
    index.query(WORLD, 3);
    for (let i = 0; i < 10; i++) {
      index.apply([{ id: `s${i}`, lng: 3 + i / 10, lat: 3 }], [], []);
      index.query(WORLD, 22);
      expect(index.builds).toBe(1);
    }
  });
});

describe('ClusterIndex: incremental equals a fresh build (property)', () => {
  it('below the bound, after every step: same features at high zoom, same total at any zoom (within the pending count)', () => {
    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 40 }), (ops) => {
        const base = grid(200); // the bound is max(200, 0.5 %), so 200 points test the same overlay path as 1000
        const model = new Map<string, ClusterPoint>(base.map((p) => [p.id, p]));
        const index = new ClusterIndex();
        index.apply(base, [], []);
        index.query(WORLD, 3);
        const touched = new Set<string>();
        const removed = new Set<string>();
        let rebuildSteps = 0; // changes WP-706 rebuilds for: removal, move, re-add of a removed id
        for (const o of ops) {
          const id = `x${o.n}`;
          const before = model.get(id);
          if (o.kind === 'remove') {
            if (before !== undefined) {
              rebuildSteps += 1;
              removed.add(id);
            }
            model.delete(id);
            index.apply([], [], [id]);
          } else {
            const p = { id, lng: o.lng, lat: o.lat };
            if (o.kind === 'add' && removed.has(id)) {
              rebuildSteps += 1;
              removed.delete(id);
            } else if (before !== undefined && (before.lng !== p.lng || before.lat !== p.lat))
              rebuildSteps += 1;
            if (o.kind === 'add') index.apply([p], [], []);
            else index.apply([], [p], []);
            model.set(id, p);
          }
          touched.add(id);
          const fresh = new ClusterIndex();
          fresh.apply([...model.values()], [], []);
          // Full result at the highest zoom: every feature at its place, nothing twice or missing.
          expect(singles(index, 22)).toEqual(singles(fresh, 22));
          // Any zoom: removals and moves rebuild, so only additions can lag, by the points changed since the build.
          const lag = Math.abs(total(index, 3) - total(fresh, 3));
          expect(lag).toBeLessThanOrEqual(touched.size);
          // Only rebuild-causing changes may rebuild (WP-706), each once; a single add of a fresh id costs none (R14).
          // Counted per change, not per distinct id: `remove x; add x` is two rebuilds for one id (WP-735).
          expect(index.builds).toBeLessThanOrEqual(1 + rebuildSteps);
        }
      }),
      { numRuns: 60 },
    );
  });
});
