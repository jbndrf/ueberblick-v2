import { describe, expect, it } from 'vitest';
import { previewShape } from './geometry-svg';

const box = { width: 240, height: 160, pad: 8 };

describe('previewShape', () => {
  it('puts a point in the middle', () => {
    const s = previewShape({ type: 'Point', coordinates: [7.1, 50.2] }, box);
    expect(s).toMatchObject({ paths: [], areas: [], points: [[120, 80]] });
    expect(s?.frame.scale).toBe(256 * 2 ** 18); // a point is shown at the deepest zoom
  });

  it('fits a line into the box, north up, and keeps the aspect', () => {
    const s = previewShape(
      {
        type: 'LineString',
        coordinates: [
          [7, 50],
          [7.002, 50.001],
        ],
      },
      box,
    );
    expect(s?.paths).toHaveLength(1);
    const nums = ((s?.paths[0] ?? '').match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const [x1, y1, x2, y2] = nums as [number, number, number, number];
    expect(Math.min(x1, x2)).toBeGreaterThanOrEqual(8);
    expect(Math.max(x1, x2)).toBeLessThanOrEqual(232);
    expect(y2).toBeLessThan(y1); // further north is higher up
    expect(x2).toBeGreaterThan(x1);
  });

  it('draws a polygon ring as a closed area and a multi geometry as several shapes', () => {
    const ring = [
      [7, 50],
      [7.01, 50],
      [7.01, 50.01],
      [7, 50],
    ];
    expect(previewShape({ type: 'Polygon', coordinates: [ring] }, box)?.areas).toHaveLength(1);
    expect(previewShape({ type: 'Polygon', coordinates: [ring] }, box)?.areas[0]).toMatch(/Z$/);
    expect(previewShape({ type: 'MultiPolygon', coordinates: [[ring], [ring]] }, box)?.areas).toHaveLength(2);
    expect(
      previewShape(
        {
          type: 'MultiPoint',
          coordinates: [
            [7, 50],
            [7.1, 50.1],
          ],
        },
        box,
      )?.points,
    ).toHaveLength(2);
  });

  it('answers null for what it cannot draw', () => {
    expect(previewShape(null, box)).toBeNull();
    expect(previewShape({ type: 'Point', coordinates: [] }, box)).toBeNull();
    expect(previewShape({ type: 'GeometryCollection', geometries: [] }, box)).toBeNull();
  });
});
