// WP-584: the cluster output (ids, counts, positions per zoom) must not change when the build gets cheaper.
// The oracle is Supercluster fed the plain GeoJSON of the points, the way the index did it before WP-584;
// the frozen digest is the output of that state for the 60k fixture of bench/map-cluster.
import Supercluster from 'supercluster';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ClusterIndex } from './index-core';
import { warmUp } from './warm';
import type { ClusterItem, ClusterPoint } from './protocol';

const RADIUS = 80;
const MAX_ZOOM = 19;

function oracle(points: readonly ClusterPoint[], bbox: [number, number, number, number], zoom: number) {
  const index = new Supercluster({ radius: RADIUS, maxZoom: MAX_ZOOM });
  index.load(
    points.map((p) => ({
      type: 'Feature' as const,
      properties: { id: p.id },
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    })),
  );
  return index.getClusters(bbox, Math.min(Math.round(zoom), MAX_ZOOM + 1)).map((f): ClusterItem => {
    const [lng = 0, lat = 0] = f.geometry.coordinates;
    const p = f.properties as { cluster?: boolean; cluster_id: number; point_count: number; id: string };
    return p.cluster === true
      ? { lng, lat, clusterId: p.cluster_id, count: p.point_count }
      : { lng, lat, featureId: p.id };
  });
}

function fixture(n: number): ClusterPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    lng: 5 + ((i * 7919) % 10_000) / 1000,
    lat: 47 + ((i * 104729) % 8_000) / 1000,
  }));
}

/** An order-sensitive digest of one output list: the same ids, counts and positions in the same order. */
function digest(items: readonly ClusterItem[]): number {
  let h = 17;
  for (const it of items) {
    const key = 'clusterId' in it ? `c${it.clusterId}:${it.count}` : `p${it.featureId}`;
    const s = `${key}@${Math.round(it.lng * 1e7)},${Math.round(it.lat * 1e7)}`;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return h;
}

describe('cluster output is unchanged by the build (WP-584)', () => {
  it('60k fixture: the digest per zoom equals the frozen one of the plain Supercluster at the v3 radius 80 / max zoom 19 (WP-722)', () => {
    const index = new ClusterIndex();
    index.apply(fixture(60_000), [], []);
    const digests = [0, 3, 6, 9, 12, 15, 17, 18].map((z) => digest(index.query([5, 47, 15, 55], z)));
    expect(digests).toEqual(FROZEN_60K);
  });

  it('a warm-up first leaves no trace in a real index', () => {
    warmUp();
    const index = new ClusterIndex();
    index.apply(fixture(60_000), [], []);
    expect([0, 3, 6, 9, 12, 15, 17, 18].map((z) => digest(index.query([5, 47, 15, 55], z)))).toEqual(
      FROZEN_60K,
    );
    expect(index.size).toBe(60_000);
  });

  it('random inputs: same items in the same order as the plain Supercluster, at every zoom', () => {
    const point = fc.record({
      lng: fc.double({ min: -179, max: 179, noNaN: true }),
      lat: fc.double({ min: -80, max: 80, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.array(point, { maxLength: 300 }), fc.integer({ min: 0, max: 18 }), (pts, zoom) => {
        const points = pts.map((p, i) => ({ id: `p${i}`, ...p }));
        const index = new ClusterIndex();
        index.apply(points, [], []);
        const bbox: [number, number, number, number] = [-180, -85, 180, 85];
        expect(index.query(bbox, zoom)).toEqual(oracle(points, bbox, zoom));
      }),
      { numRuns: 60 },
    );
  });

  it('keeps the style keys on single points and ignores others', () => {
    const index = new ClusterIndex();
    index.setKeys(['art'], []);
    index.apply(
      [
        { id: 'a', lng: 10, lat: 50, props: { art: 'Linde', secret: 1 } },
        { id: 'b', lng: 40, lat: 10, props: { art: 'Eiche' } },
      ],
      [],
      [],
    );
    const items = index.query([-180, -85, 180, 85], 10);
    expect(items.map((i) => ('featureId' in i ? [i.featureId, i.properties] : null))).toEqual([
      ['a', { art: 'Linde' }],
      ['b', { art: 'Eiche' }],
    ]);
  });
});

const FROZEN_60K = [
  1267269568, 538427522, -1103545941, 857204188, 1785728195, 1279141574, 1279141574, 1279141574,
];
