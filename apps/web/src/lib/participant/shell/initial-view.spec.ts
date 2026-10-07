// Where the participant map opens (WP-692, v3 `+page.svelte:646-666`): the view's camera, then the project's
// `map.start`, then (renderer) the fit to the features, then the renderer default.
import { describe, expect, it } from 'vitest';
import type { View } from '@ueberblick/core/model';
import { DEFAULT_CAMERA, viewHasLocations, withStartCamera } from './initial-view';

const view = (camera?: object): View =>
  ({ source: { type: 'baum' }, ...(camera ? { camera } : {}) }) as unknown as View;

describe('withStartCamera', () => {
  it('a view with a camera keeps it, whatever the project start is', () => {
    const v = view({ center: [7, 50], zoom: 12 });
    expect(withStartCamera(v, { center: [9, 48], zoom: 8 })).toBe(v);
  });
  it('a view without a camera opens at map.start (centre and zoom)', () => {
    const out = withStartCamera(view(), { center: [9, 48], zoom: 8 });
    expect(out.camera).toEqual({ center: [9, 48], zoom: 8 });
    expect(out.source).toEqual({ type: 'baum' });
  });
  it('a start without a zoom gives a camera without a zoom', () => {
    expect(withStartCamera(view(), { center: [9, 48] }).camera).toEqual({ center: [9, 48] });
  });
  it('no start leaves the view alone, so the renderer fits to the features', () => {
    const v = view();
    expect(withStartCamera(v, undefined)).toBe(v);
    expect(withStartCamera(v, undefined).camera).toBeUndefined();
  });
});

describe('a view with nothing to fit (WP-731, v3 MapCanvas.svelte:198-199)', () => {
  it('opens at the default camera when the project has no start', () => {
    expect(withStartCamera(view(), undefined, false).camera).toEqual(DEFAULT_CAMERA);
  });
  it('map.start still wins over the default', () => {
    expect(withStartCamera(view(), { center: [9, 48], zoom: 8 }, false).camera).toEqual({
      center: [9, 48],
      zoom: 8,
    });
  });
  it('the view own camera still wins', () => {
    const v = view({ center: [7, 50] });
    expect(withStartCamera(v, undefined, false)).toBe(v);
  });
  it('a view with locations is left to the renderer fit', () => {
    const v = view();
    expect(withStartCamera(v, undefined, true)).toBe(v);
  });
  it('viewHasLocations: only a type with a geometry property has places', () => {
    const types = { baum: { geometry: 'geometrie' }, einsatz: {} };
    expect(viewHasLocations(view(), types)).toBe(true);
    expect(viewHasLocations({ source: { type: 'einsatz' } } as unknown as View, types)).toBe(false);
    expect(viewHasLocations({ source: { type: 'x' } } as unknown as View, types)).toBe(false);
  });
});
