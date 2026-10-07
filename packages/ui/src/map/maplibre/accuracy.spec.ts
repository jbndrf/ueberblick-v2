// WP-646: Standort's accuracy circle is drawn in true metres (v3 user-location.ts), by the tool overlay.
import { describe, expect, it } from 'vitest';
import { mount, styled, tick } from './renderer-fixture';
import { ACCURACY_MAX_ZOOM, accuracyRadii } from './accuracy';

const point = { type: 'Point', coordinates: [7.1, 50.7] } as const;
const metresPerPixel = (zoom: number, lat: number): number =>
  (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

describe('accuracyRadii', () => {
  it('the radii at zoom 0 and the top zoom are exact for any metres and latitude (exponential-2 interpolation)', () => {
    for (const lat of [0, 30, 50.7, -65, 80]) {
      for (const m of [1, 12.5, 400, 20_000]) {
        const { r0, rMax } = accuracyRadii(m, lat);
        expect(r0 * metresPerPixel(0, lat)).toBeCloseTo(m, 6);
        expect(rMax * metresPerPixel(ACCURACY_MAX_ZOOM, lat)).toBeCloseTo(m, 6);
        // halfway: radius doubles per zoom level, so any zoom between is true metres too
        const z = 17;
        const r = r0 * 2 ** z;
        expect(r * metresPerPixel(z, lat)).toBeCloseTo(m, 6);
      }
    }
  });
});

describe('Standort overlay with an accuracy', () => {
  const layers = (calls: ReturnType<typeof mount>['calls']) => calls.layers;
  const data = (calls: ReturnType<typeof mount>['calls']) =>
    calls.setData.filter((s) => s.source === 'ub-overlay').at(-1)?.features ?? [];

  it('adds a circle layer under the dot, filled 10 % blue, stroked, radius from the feature by zoom', async () => {
    const m = mount(undefined, styled);
    await m.handle.ready;
    await tick();
    expect(layers(m.calls).indexOf('ub-overlay-accuracy')).toBeGreaterThan(-1);
    expect(layers(m.calls).indexOf('ub-overlay-accuracy')).toBeLessThan(
      layers(m.calls).indexOf('ub-overlay-point'),
    );
    const spec = (m.calls.layerSpecs as { id: string }[]).find(
      (l) => l.id === 'ub-overlay-accuracy',
    ) as unknown as {
      type: string;
      paint: Record<string, unknown>;
    };
    expect(spec.type).toBe('circle');
    expect(spec.paint['circle-opacity']).toBe(0.1);
    expect(spec.paint['circle-stroke-width']).toBe(1);
    expect(spec.paint['circle-stroke-opacity']).toBe(0.6);
    expect(JSON.stringify(spec.paint['circle-radius'])).toContain('"exponential"');
  });

  it('puts the radii on the feature; a second fix replaces it (one feature, no growth)', async () => {
    const m = mount(undefined, styled);
    await m.handle.ready;
    await tick();
    m.handle.showOverlay('standort', point, { color: '#4285f4', accuracy: 30 });
    m.handle.showOverlay('standort', point, { color: '#4285f4', accuracy: 12 });
    const f = data(m.calls);
    expect(f).toHaveLength(1);
    const { r0, rMax } = accuracyRadii(12, 50.7);
    expect(f[0]?.properties).toMatchObject({ r0, rMax });
  });

  it('an overlay without an accuracy gets no radii (the circle layer filters it out)', async () => {
    const m = mount(undefined, styled);
    await m.handle.ready;
    await tick();
    m.handle.showOverlay('m', point, { color: '#000' });
    expect(data(m.calls)[0]?.properties).not.toHaveProperty('r0');
  });
});
