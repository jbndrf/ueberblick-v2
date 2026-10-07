import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mount, tick } from './renderer-fixture';
import { createZoomLimits } from './zoom-bounds';

async function up(bounds?: { min?: number; max?: number }) {
  const m = mount(undefined, undefined, { reducedMotion: () => false });
  if (bounds !== undefined) m.handle.setZoomBounds?.(bounds);
  await m.handle.ready;
  await tick();
  return m;
}

describe('maplibre-2d renderer: the project zoom limits (map.min_zoom / map.max_zoom)', () => {
  it('opens the map with minZoom and maxZoom; absent means the renderer default', async () => {
    const { calls } = await up({ min: 4, max: 17 });
    expect(calls.options).toMatchObject({ minZoom: 4, maxZoom: 17 });
    const none = await up({ min: 6 });
    expect(none.calls.options).toMatchObject({ minZoom: 6 });
    expect(none.calls.options).not.toHaveProperty('maxZoom');
    const bare = await up();
    expect(bare.calls.options).not.toHaveProperty('minZoom');
    expect(bare.calls.options).not.toHaveProperty('maxZoom');
  });

  it('bounds set after load go to the live map; absent resets to the renderer default', async () => {
    const { handle, calls } = await up();
    handle.setZoomBounds?.({ min: 5, max: 15 });
    handle.setZoomBounds?.({ min: 7 });
    handle.setZoomBounds?.(undefined);
    expect(calls.minZoom).toEqual([5, 7, null]);
    expect(calls.maxZoom).toEqual([15, null, null]);
  });

  it('a fit never goes beyond max_zoom (the default cap is 18)', async () => {
    const a = await up({ max: 12 });
    a.handle.centerOn([8, 50, 9, 51]);
    expect(a.calls.fitted[0]).toMatchObject({ o: { maxZoom: 12 } });
    const b = await up({ max: 21 });
    b.handle.centerOn([8, 50, 9, 51]);
    expect(b.calls.fitted[0]).toMatchObject({ o: { maxZoom: 18 } });
  });

  it('a fly-to (minZoom 17) and an absolute zoom stay inside the bounds', async () => {
    const { handle, calls } = await up({ min: 2, max: 14 });
    handle.centerOn([8, 50], { minZoom: 17 });
    handle.centerOn([8, 50], { zoom: 0 });
    expect(calls.eased.slice(-2)).toMatchObject([{ zoom: 14 }, { zoom: 2 }]);
  });

  it('the zoom buttons stop at the bounds', async () => {
    const { handle, calls } = await up({ min: 3, max: 3 });
    handle.zoomBy(1);
    handle.zoomBy(-1);
    expect(calls.eased.slice(-2)).toMatchObject([{ zoom: 3 }, { zoom: 3 }]);
  });

  it('property: a clamped zoom is inside [min, max] and unchanged when already inside', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 24 }),
        fc.integer({ min: 0, max: 24 }),
        fc.double({ min: -5, max: 30, noNaN: true }).map((v) => v + 0), // +0 normalises -0 (Object.is)
        (a, b, z) => {
          const [min, max] = a <= b ? [a, b] : [b, a];
          const lim = createZoomLimits();
          lim.set({ min, max }, undefined);
          const out = lim.within({ zoom: z }).zoom as number;
          expect(out).toBeGreaterThanOrEqual(min);
          expect(out).toBeLessThanOrEqual(max);
          if (z >= min && z <= max) expect(out).toBe(z);
          expect(lim.cap(18)).toBeLessThanOrEqual(max);
        },
      ),
    );
  });
});
