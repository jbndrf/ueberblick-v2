import { describe, expect, it } from 'vitest';
import { ClusterIndex } from './index-core';
import type { ClusterPoint } from './protocol';

const WORLD = [-180, -90, 180, 90] as const;
/** Two features on one spot: they are one cluster at a low zoom. */
const pair: ClusterPoint[] = [
  { id: 'tree', lng: 10, lat: 50 },
  { id: 'area', lng: 10, lat: 50 },
];

describe('ClusterIndex: removing a member of a built cluster (WP-706)', () => {
  it('the cluster count and its leaves are exact right after the removal', () => {
    const index = new ClusterIndex();
    index.apply(pair, [], []);
    const [cluster] = index.query(WORLD, 3);
    expect(cluster?.count).toBe(2);
    index.apply([], [], ['tree']);
    const after = index.query(WORLD, 3);
    expect(after.reduce((n, i) => n + (i.count ?? 1), 0)).toBe(1);
    const again = after.find((i) => i.clusterId !== undefined);
    if (again?.clusterId !== undefined) {
      expect(index.leaves(again.clusterId).map((l) => l.featureId)).toEqual(['area']);
    }
  });

  it('a removal drops the built index (one rebuild per page, not per point)', () => {
    const index = new ClusterIndex();
    index.apply(pair, [], []);
    index.query(WORLD, 3);
    index.apply([], [], ['tree', 'area']);
    index.query(WORLD, 3);
    expect(index.builds).toBe(2);
  });

  it('an update that moves a member out of its cluster is exact; an in-place update keeps the index', () => {
    const index = new ClusterIndex();
    index.apply(pair, [], []);
    index.query(WORLD, 3);
    index.apply([], [{ id: 'tree', lng: 10, lat: 50 }], []);
    index.query(WORLD, 3);
    expect(index.builds).toBe(1);
    index.apply([], [{ id: 'tree', lng: 40, lat: 60 }], []);
    const items = index.query(WORLD, 3);
    expect(items.reduce((n, i) => n + (i.count ?? 1), 0)).toBe(2);
    expect(items).toHaveLength(2);
  });

  it('a batch add rebuilds once; a single new point keeps the overlay', () => {
    const index = new ClusterIndex();
    index.apply(pair, [], []);
    index.query(WORLD, 3);
    index.apply([{ id: 'one', lng: 10, lat: 50 }], [], []);
    index.query(WORLD, 3);
    expect(index.builds).toBe(1);
    index.apply(
      [
        { id: 'b1', lng: 10, lat: 50 },
        { id: 'b2', lng: 10, lat: 50 },
      ],
      [],
      [],
    );
    const items = index.query(WORLD, 3);
    expect(index.builds).toBe(2);
    expect(items).toHaveLength(1);
    expect(items[0]?.count).toBe(5);
  });

  it('a re-add of a removed id joins its cluster', () => {
    const index = new ClusterIndex();
    index.apply(pair, [], []);
    index.query(WORLD, 3);
    index.apply([], [], ['tree']);
    index.query(WORLD, 3);
    index.apply([{ id: 'tree', lng: 10, lat: 50 }], [], []);
    const items = index.query(WORLD, 3);
    expect(items).toHaveLength(1);
    expect(items[0]?.count).toBe(2);
  });
});
