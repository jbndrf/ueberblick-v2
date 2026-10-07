import { describe, expect, it } from 'vitest';
import { geometryDiff } from './renderer-util';
import type { FeatureChange, MapFeature } from '../contract';

const area = (color: string): MapFeature =>
  ({
    id: 'b1',
    anchor: [0, 0],
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    },
    properties: { color },
  }) as unknown as MapFeature;

const change = (add: MapFeature[], update: MapFeature[]): FeatureChange =>
  ({ add, update, remove: [] }) as unknown as FeatureChange;

describe('geometryDiff', () => {
  it('an updated area carries its new properties, so a classify colour repaints', () => {
    const drawn = new Set<string>();
    geometryDiff(drawn, change([area('#ecc94b')], []));
    const diff = geometryDiff(drawn, change([], [area('#3182ce')]));
    const props = diff?.update?.[0]?.addOrUpdateProperties ?? [];
    expect(props).toContainEqual({ key: 'color', value: '#3182ce' });
    expect(diff?.update?.[0]?.removeAllProperties).toBe(true);
  });
});
