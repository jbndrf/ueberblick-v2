// WP-730: a location step of an existing feature puts the camera on it, at the zoom v4 uses to focus one feature
// (v3's fly-to, `RECENT_MIN_ZOOM`), and leaves the map alone when the feature is already comfortably in view.
import { describe, expect, it, vi } from 'vitest';
import type { MapHandle } from '@ueberblick/ui';
import { RECENT_MIN_ZOOM } from '../sheets/recent/fly';
import { focusOn } from './focus';

const handleOf = (extent: [number, number, number, number]) => {
  const centerOn = vi.fn();
  return { handle: { extent: () => extent, centerOn } as unknown as MapHandle, centerOn };
};

describe('focusOn', () => {
  it('flies to a point at no less than the feature-level zoom when the map is at region level', () => {
    const { handle, centerOn } = handleOf([6, 49, 8, 51]);
    focusOn(handle, [7.1, 50.1]);
    expect(centerOn).toHaveBeenCalledWith([7.1, 50.1], { minZoom: RECENT_MIN_ZOOM });
  });
  it('flies when the point is street level but off to the side', () => {
    const { handle, centerOn } = handleOf([7.0, 50.0, 7.005, 50.004]);
    focusOn(handle, [7.0049, 50.0039]);
    expect(centerOn).toHaveBeenCalledOnce();
  });
  it('stays put when the point sits in the middle of a street-level view', () => {
    const { handle, centerOn } = handleOf([7.0, 50.0, 7.005, 50.004]);
    focusOn(handle, [7.0025, 50.002]);
    expect(centerOn).not.toHaveBeenCalled();
  });
  it('fits a shape that is not inside the view', () => {
    const { handle, centerOn } = handleOf([6, 49, 8, 51]);
    focusOn(handle, [7.1, 50.1, 7.2, 50.2]);
    expect(centerOn).toHaveBeenCalledWith([7.1, 50.1, 7.2, 50.2], {});
  });
  it('stays put when a shape is already inside the view', () => {
    const { handle, centerOn } = handleOf([7.0, 50.0, 7.005, 50.004]);
    focusOn(handle, [7.0015, 50.0015, 7.0035, 50.0025]);
    expect(centerOn).not.toHaveBeenCalled();
  });
});
