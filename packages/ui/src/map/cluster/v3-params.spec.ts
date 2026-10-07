// WP-722: the index clusters as v3 does: radius 80 (`MapCanvas.svelte:197`, CLUSTER_RADIUS) and the global max zoom
// (`getGlobalMaxZoom`, `MapCanvas.svelte:304-311`: the project's `max_zoom`, 19 when it sets none).
import { describe, expect, it } from 'vitest';
import { ClusterClient, createInProcessTransport } from './client';
import { ClusterIndex, CLUSTER_RADIUS, DEFAULT_MAX_ZOOM } from './index-core';
import { pointFeature } from '../test-helpers';

const WORLD = [-180, -90, 180, 90] as const;

describe('v3 cluster parameters (WP-722)', () => {
  it('uses radius 80 and a default max zoom of 19', () => {
    expect(CLUSTER_RADIUS).toBe(80);
    expect(DEFAULT_MAX_ZOOM).toBe(19);
  });

  it('radius 80: two points 73 px apart at zoom 10 form one cluster (radius 60 kept them apart)', () => {
    const index = new ClusterIndex();
    // 0.05 degree on the equator is 72.8 px at zoom 10 (Supercluster measures its radius in a 512 px world).
    index.apply(
      [
        { id: 'a', lng: 0, lat: 0 },
        { id: 'b', lng: 0.05, lat: 0 },
      ],
      [],
      [],
    );
    const items = index.query(WORLD, 10);
    expect(items).toHaveLength(1);
    expect(items[0]?.count).toBe(2);
  });

  it('known point set: a 5 x 5 grid at 0.05 degree gives 13 items at zoom 10 (25 at radius 60) and 25 singles at zoom 14', () => {
    const index = new ClusterIndex();
    const pts = Array.from({ length: 25 }, (_, i) => ({
      id: `p${i}`,
      lng: (i % 5) * 0.05,
      lat: Math.floor(i / 5) * 0.05,
    }));
    index.apply(pts, [], []);
    const z10 = index.query(WORLD, 10);
    expect(z10.reduce((n, i) => n + (i.count ?? 1), 0)).toBe(25);
    expect(z10).toHaveLength(13); // derived once with Supercluster at radius 80, maxZoom 19
    expect(index.query(WORLD, 14)).toHaveLength(25);
  });

  const near = [
    { id: 'a', lng: 10, lat: 50 },
    { id: 'b', lng: 10.0001, lat: 50 }, // 37 px apart at zoom 18
  ];

  it('default max zoom 19: points 37 px apart still cluster at zoom 18 and separate at 20', () => {
    const index = new ClusterIndex();
    index.apply(near, [], []);
    expect(index.query(WORLD, 18).filter((i) => i.count !== undefined)).toHaveLength(1);
    expect(index.query(WORLD, 20).every((i) => i.featureId !== undefined)).toBe(true);
  });

  it('the project max zoom: above it everything is single, at it clusters still hold', () => {
    const index = new ClusterIndex();
    index.apply(near, [], []);
    index.setMaxZoom(10);
    expect(index.query(WORLD, 11).every((i) => i.featureId !== undefined)).toBe(true);
    expect(index.query(WORLD, 10).filter((i) => i.count !== undefined)).toHaveLength(1);
    index.setMaxZoom(undefined);
    expect(index.query(WORLD, 18).filter((i) => i.count !== undefined)).toHaveLength(1);
  });

  it('the capped query separates the singles above the project max zoom', () => {
    const index = new ClusterIndex();
    index.apply(near, [], []);
    index.setMaxZoom(8);
    const r = index.queryCapped(WORLD, 8, 10);
    expect(r.single).toBe(true);
    expect(r.items).toHaveLength(2);
  });

  it('the client sends the max zoom through the worker channel', () => {
    const client = new ClusterClient(createInProcessTransport());
    client.apply({ add: near.map((p) => pointFeature(p.id, p.lng, p.lat)), update: [], remove: [] });
    client.setMaxZoom(10);
    return client.query(WORLD, 11).then((items) => {
      expect(items.every((i) => i.featureId !== undefined)).toBe(true);
    });
  });
});
