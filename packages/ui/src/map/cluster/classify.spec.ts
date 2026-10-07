// WP-674 (B-018): a cluster carries how many members hold each value of the classifying property.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ClusterIndex, UNSET } from './index-core';
import type { ClusterPoint } from './protocol';

const WORLD = [4, 46, 7, 49] as const; // the points' extent: a whole-world box wraps at low zoom and lists clusters twice
const VALUES = ['a', 'b', 'c'] as const;

const points = (n: number): ClusterPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    lng: 5 + ((i * 7919) % 1000) / 1000,
    lat: 47 + ((i * 104729) % 800) / 1000,
    props: i % 7 === 6 ? {} : { art: VALUES[i % 3] as string },
  }));

function index(n: number, key: string | undefined): ClusterIndex {
  const ix = new ClusterIndex();
  ix.setKeys(['art'], []);
  ix.apply(points(n), [], []);
  ix.setClassify(key);
  return ix;
}

describe('cluster counts by the classifying property', () => {
  it('counts add up to the cluster size and match the members', () => {
    const ix = index(500, 'art');
    const clusters = ix.query(WORLD, 4).filter((i) => i.clusterId !== undefined);
    expect(clusters.length).toBeGreaterThan(0);
    for (const c of clusters) {
      const counts = c.counts ?? {};
      expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(c.count);
      const members = ix.leaves(c.clusterId ?? -1);
      for (const k of Object.keys(counts)) {
        const held = members.filter(
          (m) => (typeof m.properties?.art === 'string' ? m.properties.art : UNSET) === k,
        );
        expect(held.length).toBe(counts[k]);
      }
    }
  });
  it('a feature without a string value counts under _unset', () => {
    const counts =
      index(60, 'art')
        .query(WORLD, 0)
        .find((i) => i.clusterId !== undefined)?.counts ?? {};
    expect(counts[UNSET]).toBeGreaterThan(0);
  });
  it('carries no counts without a classifying property, and drops them when it is turned off', () => {
    const ix = index(300, undefined);
    expect(ix.query(WORLD, 4).every((i) => i.counts === undefined)).toBe(true);
    ix.setClassify('art');
    expect(ix.query(WORLD, 4).some((i) => i.counts !== undefined)).toBe(true);
    ix.setClassify(undefined);
    expect(ix.query(WORLD, 4).every((i) => i.counts === undefined)).toBe(true);
  });
  it('property: at every zoom the counts of the clusters in view sum to the features in view', () => {
    const ix = index(400, 'art');
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 16 }), (zoom) => {
        const items = ix.query(WORLD, zoom);
        const total = items.reduce((n, i) => n + (i.count ?? 1), 0);
        const counted = items.reduce(
          (n, i) => n + (i.counts === undefined ? 1 : Object.values(i.counts).reduce((a, b) => a + b, 0)),
          0,
        );
        expect(counted).toBe(total);
        expect(total).toBe(400);
      }),
      { numRuns: 17 },
    );
  });
});
