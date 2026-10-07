// WP-653: the members of a tapped cluster come from the worker's index (Supercluster `getLeaves`), so the cost is the
// size of the cluster, never the number of features on the device (R14).
import { describe, expect, it } from 'vitest';
import { pointFeature } from '../test-helpers';
import { ClusterClient, createInProcessTransport } from './client';
import { ClusterIndex } from './index-core';

const WORLD = [-180, -90, 180, 90] as const;

describe('ClusterIndex.leaves', () => {
  it('returns every member of a cluster as a single, with its position and the used properties', () => {
    const index = new ClusterIndex();
    index.setKeys(['colour'], []);
    index.apply(
      [
        { id: 'a', lng: 10, lat: 50, props: { colour: 'red' } },
        { id: 'b', lng: 10.0001, lat: 50.0001 },
        { id: 'c', lng: 10.0002, lat: 50.0002 },
        { id: 'far', lng: 20, lat: 40 },
      ],
      [],
      [],
    );
    const cluster = index.query(WORLD, 2).find((i) => i.clusterId !== undefined);
    expect(cluster?.count).toBe(3);
    const leaves = index.leaves(cluster?.clusterId ?? -1);
    expect(leaves.map((l) => l.featureId).sort()).toEqual(['a', 'b', 'c']);
    expect(leaves.find((l) => l.featureId === 'a')?.properties).toEqual({ colour: 'red' });
    expect(leaves.find((l) => l.featureId === 'a')?.lng).toBeCloseTo(10, 6);
  });
});

describe('ClusterClient.leaves', () => {
  it('asks the worker and resolves with the members', async () => {
    const client = new ClusterClient(createInProcessTransport());
    client.apply({
      add: [pointFeature('a', 10, 50), pointFeature('b', 10.0001, 50.0001)],
      update: [],
      remove: [],
    });
    const cluster = (await client.query([...WORLD], 2)).find((i) => i.clusterId !== undefined);
    const leaves = await client.leaves(cluster?.clusterId ?? -1);
    expect(leaves.map((l) => l.featureId).sort()).toEqual(['a', 'b']);
  });
});

describe('ClusterIndex.byIds (WP-647)', () => {
  it('returns the held features of the ids with their positions, leaves unknown ids out, in id order', () => {
    const index = new ClusterIndex();
    index.setKeys(['colour'], []);
    index.apply(
      [
        { id: 'a', lng: 10, lat: 50, props: { colour: 'red' } },
        { id: 'b', lng: 11, lat: 51 },
        { id: 'far', lng: 20, lat: 40 },
      ],
      [],
      [],
    );
    const items = index.byIds(['far', 'nope', 'a']);
    expect(items.map((i) => i.featureId)).toEqual(['far', 'a']);
    expect(items[0]).toMatchObject({ lng: 20, lat: 40 });
    expect(items[1]?.properties).toEqual({ colour: 'red' });
  });

  it('sees updates and removals, and never builds the index', () => {
    const index = new ClusterIndex();
    index.apply([{ id: 'a', lng: 1, lat: 1 }], [], []);
    index.apply([], [{ id: 'a', lng: 2, lat: 3 }], []);
    expect(index.byIds(['a'])[0]).toMatchObject({ lng: 2, lat: 3 });
    index.apply([], [], ['a']);
    expect(index.byIds(['a'])).toEqual([]);
    expect(index.builds).toBe(0);
  });
});

describe('ClusterClient.byIds', () => {
  it('asks the worker and resolves with the held features', async () => {
    const client = new ClusterClient(createInProcessTransport());
    client.apply({ add: [pointFeature('a', 10, 50), pointFeature('b', 11, 51)], update: [], remove: [] });
    const items = await client.byIds(['b']);
    expect(items.map((i) => i.featureId)).toEqual(['b']);
    expect(items[0]?.lng).toBeCloseTo(11, 6);
  });
});
