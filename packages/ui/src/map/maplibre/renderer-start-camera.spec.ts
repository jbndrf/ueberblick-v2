import { describe, expect, it } from 'vitest';
import type { View } from '@ueberblick/core/model';
import { pointFeature } from '../test-helpers';
import { mount, tick } from './renderer-fixture';

// The shell hands the renderer `map.start` as the view's camera (WP-692); these are the renderer's side of it.
const at = (camera: object): View => ({ camera }) as unknown as View;

describe('maplibre-2d renderer: opening at the project start (WP-692)', () => {
  it('opens at the start camera and does not fit to the features that arrive', async () => {
    const { handle, calls } = mount([pointFeature('a', 7, 50)], at({ center: [9, 48], zoom: 8 }));
    await handle.ready;
    await tick();
    expect(calls.options).toMatchObject({ center: [9, 48], zoom: 8 });
    expect(calls.fitted).toEqual([]);
  });
  it('the start zoom stays inside the zoom bounds', async () => {
    const hi = mount(undefined, at({ center: [9, 48], zoom: 20 }));
    hi.handle.setZoomBounds?.({ min: 3, max: 12 });
    await hi.handle.ready;
    expect(hi.calls.options).toMatchObject({ zoom: 12 });
    const lo = mount(undefined, at({ center: [9, 48], zoom: 1 }));
    lo.handle.setZoomBounds?.({ min: 3, max: 12 });
    await lo.handle.ready;
    expect(lo.calls.options).toMatchObject({ zoom: 3 });
  });
});
