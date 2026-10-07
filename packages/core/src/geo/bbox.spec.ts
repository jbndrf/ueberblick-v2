import { describe, expect, it } from 'vitest';
import { bboxOf, bboxOfCached, forEachPosition, unionBbox } from './bbox';
import type { Bbox, Geometry, Position } from './contract';

const ring = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
  [0, 0],
] as const;

describe('bboxOf', () => {
  it('Point', () => {
    expect(bboxOf({ type: 'Point', coordinates: [13.4, 52.5] })).toEqual([13.4, 52.5, 13.4, 52.5]);
  });
  it('MultiPoint', () => {
    expect(
      bboxOf({
        type: 'MultiPoint',
        coordinates: [
          [1, 5],
          [-2, 3],
          [4, -1],
        ],
      }),
    ).toEqual([-2, -1, 4, 5]);
  });
  it('LineString', () => {
    expect(
      bboxOf({
        type: 'LineString',
        coordinates: [
          [1, 1],
          [3, 0],
          [2, 7],
        ],
      }),
    ).toEqual([1, 0, 3, 7]);
  });
  it('MultiLineString', () => {
    expect(
      bboxOf({
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
          [
            [-5, 2],
            [6, -3],
          ],
        ],
      }),
    ).toEqual([-5, -3, 6, 2]);
  });
  it('Polygon with a hole uses the exterior extent', () => {
    expect(
      bboxOf({
        type: 'Polygon',
        coordinates: [
          ring,
          [
            [1, 1],
            [1, 2],
            [2, 2],
            [1, 1],
          ],
        ],
      }),
    ).toEqual([0, 0, 4, 3]);
  });
  it('MultiPolygon', () => {
    expect(
      bboxOf({
        type: 'MultiPolygon',
        coordinates: [
          [ring],
          [
            [
              [10, 10],
              [12, 10],
              [12, 15],
              [10, 10],
            ],
          ],
        ],
      }),
    ).toEqual([0, 0, 12, 15]);
  });
  it('GeometryCollection, nested', () => {
    const g: Geometry = {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Point', coordinates: [-7, 1] },
        {
          type: 'GeometryCollection',
          geometries: [
            {
              type: 'LineString',
              coordinates: [
                [2, 2],
                [9, -4],
              ],
            },
          ],
        },
      ],
    };
    expect(bboxOf(g)).toEqual([-7, -4, 9, 2]);
  });
  it('ignores Z', () => {
    expect(
      bboxOf({
        type: 'LineString',
        coordinates: [
          [1, 2, 900],
          [3, 4, -900],
        ],
      }),
    ).toEqual([1, 2, 3, 4]);
  });
  it('is undefined for empty coordinates', () => {
    expect(bboxOf({ type: 'MultiPoint', coordinates: [] })).toBeUndefined();
    expect(bboxOf({ type: 'GeometryCollection', geometries: [] })).toBeUndefined();
    expect(bboxOf({ type: 'Polygon', coordinates: [] })).toBeUndefined();
  });
});

describe('forEachPosition', () => {
  const collect = (g: Geometry): Position[] => {
    const out: Position[] = [];
    forEachPosition(g, (p) => out.push(p));
    return out;
  };
  it('visits every position in document order', () => {
    expect(collect({ type: 'Point', coordinates: [1, 2] })).toEqual([[1, 2]]);
    expect(
      collect({
        type: 'MultiPolygon',
        coordinates: [
          [ring],
          [
            [
              [9, 9],
              [8, 8],
              [9, 9],
            ],
          ],
        ],
      }),
    ).toHaveLength(8);
    expect(
      collect({
        type: 'GeometryCollection',
        geometries: [
          { type: 'Point', coordinates: [1, 1] },
          {
            type: 'MultiPoint',
            coordinates: [
              [2, 2],
              [3, 3],
            ],
          },
        ],
      }),
    ).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });
  it('visits nothing for an empty geometry and keeps Z', () => {
    expect(collect({ type: 'LineString', coordinates: [] })).toEqual([]);
    expect(collect({ type: 'Point', coordinates: [1, 2, 3] })).toEqual([[1, 2, 3]]);
  });
});

describe('unionBbox', () => {
  it('unions boxes and skips undefined', () => {
    const boxes: (Bbox | undefined)[] = [[0, 0, 1, 1], undefined, [-2, 0.5, 0.5, 4]];
    expect(unionBbox(boxes)).toEqual([-2, 0, 1, 4]);
  });
  it('is undefined when there is nothing to union', () => {
    expect(unionBbox([])).toBeUndefined();
    expect(unionBbox([undefined, undefined])).toBeUndefined();
  });
  it('returns a copy, never the input box', () => {
    const b: Bbox = [1, 2, 3, 4];
    expect(unionBbox([b])).not.toBe(b);
    expect(unionBbox([b])).toEqual(b);
  });
});

describe('bboxOfCached (WP-579)', () => {
  it('equals bboxOf and scans a geometry object once', () => {
    let reads = 0;
    const g = {
      type: 'Polygon',
      get coordinates() {
        reads++;
        return [ring.map((p) => [...p])];
      },
    } as unknown as Geometry;
    expect(bboxOfCached(g)).toEqual([0, 0, 4, 3]);
    expect(bboxOfCached(g)).toEqual(bboxOf(g));
    expect(bboxOfCached(g)).toEqual([0, 0, 4, 3]);
    // one scan for the first cached call, one for the direct bboxOf above
    expect(reads).toBe(2);
  });

  it('caches an empty geometry as undefined', () => {
    const g: Geometry = { type: 'GeometryCollection', geometries: [] };
    expect(bboxOfCached(g)).toBeUndefined();
    expect(bboxOfCached(g)).toBeUndefined();
  });
});
