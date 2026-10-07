import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { testSource } from './test-helpers';
import { createRendererMap, getRenderer } from './renderers';

describe('lazy renderer', () => {
  it('renderers.ts imports the maplibre renderer only dynamically', () => {
    const src = readFileSync(new URL('./renderers.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/^import[^;]*from\s+'\.\/maplibre/m);
    expect(src).toMatch(/import\('\.\/maplibre\/renderer'\)/);
  });

  it('mount returns a usable handle at once; destroy before load is safe', async () => {
    const renderer = getRenderer(createRendererMap(), 'maplibre-2d');
    const handle = renderer.mount({} as HTMLElement, {} as never, testSource([]));
    const off = handle.onFeatureTap(() => undefined);
    expect(typeof off).toBe('function');
    expect(handle.extent()).toEqual([-180, -90, 180, 90]);
    handle.destroy();
    await handle.ready.catch(() => undefined);
  });

  it('the tool ports work before MapLibre is loaded: taps, overlays and centring are handed over', () => {
    const handle = getRenderer(createRendererMap(), 'maplibre-2d').mount(
      {} as HTMLElement,
      {} as never,
      testSource([]),
    );
    const off = handle.onMapTap(() => undefined);
    expect(() => {
      handle.showOverlay('m', { type: 'Point', coordinates: [1, 2] }, { color: '#000' });
      handle.clearOverlay('m');
      handle.centerOn([1, 2], { zoom: 3 });
      off();
    }).not.toThrow();
    handle.destroy();
  });

  it('the basemaps asked for before MapLibre is loaded are handed over (WP-621)', () => {
    const handle = getRenderer(createRendererMap(), 'maplibre-2d').mount(
      {} as HTMLElement,
      {} as never,
      testSource([]),
    );
    expect(() =>
      handle.setBasemaps?.({ layers: {} } as never, { base: undefined, overlays: [] }),
    ).not.toThrow();
    handle.destroy();
  });
});
