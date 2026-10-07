import { describe, expect, it } from 'vitest';
import { mount } from './renderer-fixture';

describe('maplibre-2d renderer: v3 interaction', () => {
  it('pans and pinch-zooms but never rotates or tilts, with a few pixels of slack on a tap', async () => {
    const { handle, calls } = mount();
    await handle.ready;
    expect(calls.options).toMatchObject({
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      clickTolerance: 5,
    });
  });

  it('turns double-click zoom off and on, also when asked before the map has loaded', async () => {
    const { handle, calls } = mount();
    handle.setDoubleClickZoom(false);
    await handle.ready;
    expect(calls.doubleClick).toEqual([false]);
    handle.setDoubleClickZoom(true);
    expect(calls.doubleClick).toEqual([false, true]);
  });

  it('leaves double-click zoom alone when nobody asked', async () => {
    const { handle, calls } = mount();
    await handle.ready;
    expect(calls.doubleClick).toEqual([]);
  });

  it('credits the tile sources in the compact attribution control, as v3 (MapCanvas.svelte:1031)', async () => {
    const { handle, calls } = mount();
    await handle.ready;
    expect(calls.options).toMatchObject({ attributionControl: { compact: true } });
  });
});
