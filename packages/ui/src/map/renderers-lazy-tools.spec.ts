// The lazy wrapper hands the tool calls made before MapLibre has loaded to the real handle, in order (WP-576).
import { describe, expect, it, vi } from 'vitest';
import type { Geometry, Position } from '@ueberblick/core/geo';
import type { MapHandle } from './contract';
import { testSource } from './test-helpers';

const log: string[] = [];
const inner: Partial<MapHandle> = {
  ready: Promise.resolve(),
  onFeatureTap: () => () => undefined,
  onExtentChange: () => () => undefined,
  onMapTap: () => {
    log.push('tap');
    return () => undefined;
  },
  showOverlay: (id, g) => void log.push(`show:${id}:${(g as { type: string }).type}`),
  clearOverlay: (id) => void log.push(`clear:${id}`),
  centerOn: (t, o) => void log.push(`centre:${JSON.stringify(t)}:${o?.zoom ?? '-'}`),
  zoomBy: (d) => void log.push(`zoom:${d}`),
  setDoubleClickZoom: (on) => void log.push(`dblzoom:${on}`),
  onMarkerDrag: () => {
    log.push('drag');
    return () => undefined;
  },
  onMove: () => {
    log.push('move');
    return () => undefined;
  },
  addMarker: (id, at) => void log.push(`marker:${id}:${at.join(',')}`),
  moveMarker: (id, at) => void log.push(`moved:${id}:${at.join(',')}`),
  removeMarker: (id) => void log.push(`unmarked:${id}`),
  destroy: () => undefined,
};

vi.mock('./maplibre/renderer', () => ({
  createMaplibreRenderer: () => ({ mount: () => inner }),
}));

const { createRendererMap, getRenderer } = await import('./renderers');
const point = (c: Position): Geometry => ({ type: 'Point', coordinates: [...c] }) as Geometry;
const line: Geometry = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [1, 1],
  ],
};
const style = { color: '#000' };
const mount = (): MapHandle =>
  getRenderer(createRendererMap(), 'maplibre-2d').mount({} as HTMLElement, {} as never, testSource([]));

describe('lazy renderer tool calls before load', () => {
  it('reach the inner handle in order, the last centring only', async () => {
    log.length = 0;
    const handle = mount();
    handle.onMapTap(() => undefined);
    handle.showOverlay('a', point([1, 2]), style);
    handle.centerOn([1, 2], { zoom: 5 });
    handle.centerOn([3, 4]);
    expect(log).toEqual([]); // nothing reaches the inner handle before it exists
    await handle.ready;
    expect(log).toEqual(['tap', 'show:a:Point', 'centre:[3,4]:-']);
  });

  it('a show then clear before load leaves nothing; a second show on the same id replaces the first', async () => {
    log.length = 0;
    const handle = mount();
    handle.showOverlay('gone', point([1, 2]), style);
    handle.clearOverlay('gone');
    handle.showOverlay('kept', point([1, 2]), style);
    handle.showOverlay('kept', line, style);
    await handle.ready;
    expect(log).toEqual(['show:kept:LineString']);
  });

  it('after load, calls go straight through', async () => {
    const handle = mount();
    await handle.ready;
    log.length = 0;
    handle.showOverlay('x', line, style);
    handle.clearOverlay('x');
    expect(log).toEqual(['show:x:LineString', 'clear:x']);
  });
  it('zoomBy is delegated to the renderer once it exists', async () => {
    const handle = mount();
    await handle.ready;
    log.length = 0;
    handle.zoomBy(2);
    expect(log).toEqual(['zoom:2']);
  });
});

describe('lazy renderer marker calls before load', () => {
  const el = {} as HTMLElement;
  it('replays listeners and the buffered marker at its latest position; reads it back before load', async () => {
    log.length = 0;
    const handle = mount();
    handle.onMarkerDrag(() => undefined);
    handle.onMove(() => undefined);
    handle.addMarker('pin', [1, 2], { element: el, draggable: true });
    handle.moveMarker('pin', [3, 4]);
    expect(handle.markerPosition('pin')).toEqual([3, 4]);
    expect(log).toEqual([]);
    await handle.ready;
    expect(log).toEqual(['drag', 'move', 'marker:pin:3,4']);
  });

  it('a removed marker and a listener unsubscribed before load are not replayed', async () => {
    log.length = 0;
    const handle = mount();
    handle.onMarkerDrag(() => undefined)();
    handle.onMove(() => undefined)();
    handle.addMarker('gone', [1, 2], { element: el });
    handle.removeMarker('gone');
    expect(handle.markerPosition('gone')).toBeUndefined();
    await handle.ready;
    expect(log).toEqual([]);
  });

  it('after load the calls go straight to the real handle', async () => {
    const handle = mount();
    await handle.ready;
    log.length = 0;
    handle.addMarker('pin', [1, 2], { element: el });
    handle.moveMarker('pin', [5, 6]);
    handle.removeMarker('pin');
    expect(log).toEqual(['marker:pin:1,2', 'moved:pin:5,6', 'unmarked:pin']);
  });
});
