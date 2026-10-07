import { describe, expect, it } from 'vitest';
import { LAYER_IDS } from './layers';
import { createMaplibreRenderer } from './renderer';
import { createInProcessTransport } from '../cluster/client';
import { testSource } from '../test-helpers';
import { fakeMaplibre, tick } from './renderer-fixture';
import { readMapState } from './probe';

// WP-745: the e2e seam. The element carries what the map holds (limits, look images, the icon expression), written at idle.
describe('the data-map-state seam', () => {
  it('is written at idle from the map, not from the renderer', async () => {
    const { api, calls } = fakeMaplibre();
    const attrs = new Map<string, string>();
    const el = { setAttribute: (k: string, v: string) => attrs.set(k, v) } as unknown as HTMLElement;
    const handle = createMaplibreRenderer({
      load: () => Promise.resolve(api),
      transport: createInProcessTransport,
      probe: true,
    }).mount(el, { key: 'v', source: { type: 't' } } as never, testSource([]));
    handle.setZoomBounds?.({ min: 4, max: 9 });
    await handle.ready;
    await tick();
    expect(attrs.has('data-map-state')).toBe(false);
    calls.handlers.get('idle')?.();
    const state = JSON.parse(attrs.get('data-map-state') ?? '{}') as ReturnType<typeof readMapState>;
    expect(state).toMatchObject({ minZoom: 4, maxZoom: 9, zoom: 3, clusters: 0, singles: 0 });
    handle.destroy();
  });

  it('is off by default (production): no idle listener is attached, nothing is written', async () => {
    const { api, calls } = fakeMaplibre();
    const attrs = new Map<string, string>();
    const el = { setAttribute: (k: string, v: string) => attrs.set(k, v) } as unknown as HTMLElement;
    const handle = createMaplibreRenderer({
      load: () => Promise.resolve(api),
      transport: createInProcessTransport,
    }).mount(el, { key: 'v', source: { type: 't' } } as never, testSource([]));
    await handle.ready;
    await tick();
    expect(calls.handlers.has('idle')).toBe(false);
    expect(attrs.has('data-map-state')).toBe(false);
    handle.destroy();
  });

  it('writes only a changed state', async () => {
    const { api, calls } = fakeMaplibre();
    let writes = 0;
    const el = {
      setAttribute: (k: string) => {
        if (k === 'data-map-state') writes++;
      },
    } as unknown as HTMLElement;
    const handle = createMaplibreRenderer({
      load: () => Promise.resolve(api),
      transport: createInProcessTransport,
      probe: true,
    }).mount(el, { key: 'v', source: { type: 't' } } as never, testSource([]));
    await handle.ready;
    await tick();
    calls.handlers.get('idle')?.();
    calls.handlers.get('idle')?.();
    expect(writes).toBe(1);
    handle.destroy();
  });

  it('reads no icon expression from a circle layer (MapLibre throws on it)', async () => {
    const { api } = fakeMaplibre();
    const m = new api.Map({} as never);
    m.addSource('ub-clusters', {});
    m.addLayer({ id: LAYER_IDS.single, type: 'circle', source: 'ub-clusters', paint: {} });
    expect(readMapState(m, new Set([LAYER_IDS.single])).iconImage).toBeNull();
  });

  it('counts rendered clusters and singles and reads the icon expression and look images', async () => {
    const { api, calls } = fakeMaplibre();
    const m = new api.Map({} as never);
    m.addSource('ub-clusters', {});
    m.addLayer({
      id: LAYER_IDS.single,
      type: 'symbol',
      source: 'ub-clusters',
      layout: { 'icon-image': ['literal', 'x'] },
    });
    m.addImage('ub-look-a', {});
    m.addImage('other', {});
    calls.rendered.push({ layer: { id: LAYER_IDS.single }, properties: {} });
    const state = readMapState(m, new Set([LAYER_IDS.single]));
    expect(state).toMatchObject({
      singles: 1,
      clusters: 0,
      iconImage: ['literal', 'x'],
      images: ['ub-look-a'],
    });
  });
});
