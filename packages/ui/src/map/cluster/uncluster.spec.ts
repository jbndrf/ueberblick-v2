import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ClusterIndex } from './index-core';
import type { ClusterPoint } from './protocol';

const WORLD = [-180, -90, 180, 90] as const;
const points = (n: number): ClusterPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    lng: 10 + (i % 20) * 0.0005,
    lat: 50 + Math.floor(i / 20) * 0.0005,
  }));

describe('ClusterIndex.queryCapped (v3 two-phase query, in the worker)', () => {
  it('draws every feature in view singly when the count is within the cap', () => {
    const index = new ClusterIndex();
    index.apply(points(40), [], []);
    expect(index.query(WORLD, 5).some((i) => i.count !== undefined)).toBe(true); // clustered without the cap
    const r = index.queryCapped(WORLD, 5, 40);
    expect(r).toMatchObject({ inView: 40, single: true });
    expect(r.items).toHaveLength(40);
    expect(r.items.every((i) => i.featureId !== undefined)).toBe(true);
  });

  it('stays clustered above the cap and still reports the count in view', () => {
    const index = new ClusterIndex();
    index.apply(points(40), [], []);
    const r = index.queryCapped(WORLD, 5, 39);
    expect(r).toMatchObject({ inView: 40, single: false });
    expect(r.items.some((i) => i.count !== undefined)).toBe(true);
  });

  it('counts only what is in the bbox', () => {
    const index = new ClusterIndex();
    index.apply(
      [
        { id: 'in', lng: 10, lat: 50 },
        { id: 'out', lng: 30, lat: 50 },
      ],
      [],
      [],
    );
    expect(index.queryCapped([9, 49, 11, 51], 5, 10)).toMatchObject({ inView: 1, single: true });
  });

  it('an empty view has nothing to show and is not "single"', () => {
    expect(new ClusterIndex().queryCapped(WORLD, 5, 10)).toMatchObject({ inView: 0, single: false });
  });

  it('sees changes made since the build (pending overlay)', () => {
    const index = new ClusterIndex();
    index.apply(points(10), [], []);
    index.queryCapped(WORLD, 5, 100);
    index.apply([{ id: 'new', lng: 10.001, lat: 50.001 }], [], ['f0']);
    const r = index.queryCapped(WORLD, 5, 100);
    expect(r.inView).toBe(10);
    expect(r.items.map((i) => i.featureId)).toContain('new');
    expect(r.items.map((i) => i.featureId)).not.toContain('f0');
  });

  it('property: within the cap every point in view appears once as a single; above it, none is lost from the count', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.double({ min: 5, max: 15, noNaN: true }), fc.double({ min: 45, max: 55, noNaN: true })),
          { maxLength: 80 },
        ),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 14 }),
        (coords, cap, zoom) => {
          const index = new ClusterIndex();
          index.apply(
            coords.map(([lng, lat], i) => ({ id: `p${i}`, lng, lat })),
            [],
            [],
          );
          const r = index.queryCapped(WORLD, zoom, cap);
          expect(r.inView).toBe(coords.length);
          if (coords.length > 0 && coords.length <= cap) {
            expect(r.single).toBe(true);
            expect(new Set(r.items.map((i) => i.featureId)).size).toBe(coords.length);
          } else if (coords.length > cap) expect(r.single).toBe(false);
        },
      ),
      { numRuns: 60 },
    );
  });
});
