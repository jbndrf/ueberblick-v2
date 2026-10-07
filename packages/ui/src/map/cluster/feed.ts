import type { Json } from '@ueberblick/core/model';

export type Props = { [key: string]: Json };

/** One held point: the worker's whole per-feature state (one allocation, WP-584). */
export class HeldPoint {
  constructor(
    readonly featureId: string,
    readonly lng: number,
    readonly lat: number,
    public props: Props | undefined,
  ) {}
}

/** What Supercluster reads of one input point, and nothing else. */
interface FeedFeature {
  readonly type: 'Feature';
  properties: HeldPoint;
  readonly geometry: { readonly type: 'Point'; readonly coordinates: [number, number] };
}

/**
 * The points as the list Supercluster loads: it needs only `length` and two passes of `for...of`. Each step
 * yields the SAME feature object with the next point's coordinates and `properties`, because Supercluster
 * reads the coordinates at once (into typed arrays) and keeps only `properties`. So the build allocates no
 * GeoJSON wrapper per point, and the held point is the one `properties` object Supercluster hands back for a
 * single feature. The feature has no `id`: Supercluster would keep a parallel id array for it.
 */
export function feedOf(points: readonly HeldPoint[]): FeedFeature[] {
  const coordinates: [number, number] = [0, 0];
  const feature: FeedFeature = {
    type: 'Feature',
    properties: points[0] as HeldPoint,
    geometry: { type: 'Point', coordinates },
  };
  const feed = {
    length: points.length,
    [Symbol.iterator]: (): Iterator<FeedFeature> => {
      let i = 0;
      return {
        next: (): IteratorResult<FeedFeature> => {
          const point = points[i++];
          if (point === undefined) return { done: true, value: undefined };
          feature.properties = point;
          coordinates[0] = point.lng;
          coordinates[1] = point.lat;
          return { done: false, value: feature };
        },
      };
    },
  };
  return feed as unknown as FeedFeature[];
}
