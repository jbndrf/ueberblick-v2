import { describe, expect, it, vi } from 'vitest';
import type { View } from '@ueberblick/core/model';
import type { MapHandle } from '@ueberblick/ui';
import { centerOfExtent, drawableView, mapToolPort, tappableHandle } from './map-view';

const view = {
  source: { type: 'baum' },
  layers: {
    a: { renderer: 'maplibre-2d', style: { $ref: 'styles/baum.json' }, source: { type: 'baum' } },
    b: { renderer: 'maplibre-2d', style: { layers: [] } },
    c: { renderer: 'maplibre-2d' },
  },
} as unknown as View;

describe('drawableView', () => {
  it('leaves out a $ref layer, reports it by key, and keeps resolved layers', () => {
    const out = drawableView(view);
    expect(Object.keys(out.view.layers ?? {})).toEqual(['b', 'c']);
    expect(out.unresolved).toEqual([{ layer: 'a', ref: 'styles/baum.json' }]);
    expect(out.drawable).toBe(true);
    expect(out.view.source).toBe(view.source);
  });

  it('a view whose layers are all unresolved has nothing to draw', () => {
    const only = { source: { type: 'baum' }, layers: { a: view.layers?.['a'] } } as unknown as View;
    const out = drawableView(only);
    expect(out.drawable).toBe(false);
    expect(out.unresolved).toHaveLength(1);
  });

  it('a view without layers is returned as it is and draws', () => {
    const plain = { source: { type: 'baum' } } as View;
    expect(drawableView(plain)).toEqual({ view: plain, unresolved: [], drawable: true });
  });
});

const handle = (over: Record<string, unknown> = {}): MapHandle =>
  ({ extent: () => [7, 50, 8, 51], ...over }) as unknown as MapHandle;
const style = { color: '#1b5e3b' };

describe('mapToolPort', () => {
  it('without a map the port does nothing and Measure cannot be hosted', () => {
    const p = mapToolPort(undefined, style);
    expect(p.canTap).toBe(false);
    expect(() => p.port.onTap(() => undefined)()).not.toThrow();
  });

  it('with a map every call goes to the handle, the overlay under one id with the theme style', () => {
    const onMapTap = vi.fn(() => () => undefined);
    const centerOn = vi.fn();
    const showOverlay = vi.fn();
    const clearOverlay = vi.fn();
    const p = mapToolPort(handle({ onMapTap, centerOn, showOverlay, clearOverlay }), style);
    const line = {
      type: 'LineString',
      coordinates: [
        [7, 50],
        [8, 51],
      ],
    } as const;
    expect(p.canTap).toBe(true);
    p.port.onTap(() => undefined);
    p.port.centerOn([7, 50], 15);
    p.port.centerOn([7, 50]);
    p.port.showOverlay(line);
    p.port.clearOverlay();
    expect(onMapTap).toHaveBeenCalledTimes(1);
    expect(centerOn).toHaveBeenNthCalledWith(1, [7, 50], { zoom: 15 });
    expect(centerOn).toHaveBeenNthCalledWith(2, [7, 50], undefined);
    expect(showOverlay).toHaveBeenCalledWith('tool', line, style);
    expect(clearOverlay).toHaveBeenCalledWith('tool');
  });
});

describe('centerOfExtent', () => {
  it('is the middle of a real extent and unknown for the whole world', () => {
    expect(centerOfExtent(handle())).toEqual([7.5, 50.5]);
    expect(centerOfExtent(handle({ extent: () => [-180, -90, 180, 90] }))).toBeUndefined();
    expect(centerOfExtent(undefined)).toBeUndefined();
  });
});

describe('tappableHandle (WP-585)', () => {
  const handle = { extent: () => [7, 50, 8, 51] } as unknown as MapHandle;
  it('Measure is not offered while the list is the view, and is offered again when the map returns', () => {
    expect(mapToolPort(tappableHandle(handle, true), { color: '#000' }).canTap).toBe(false);
    expect(mapToolPort(tappableHandle(handle, false), { color: '#000' }).canTap).toBe(true);
  });
  it('no map stays no map', () => {
    expect(tappableHandle(undefined, false)).toBeUndefined();
  });
});
