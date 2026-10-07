// @vitest-environment jsdom
// DOM markers of the maplibre-2d renderer: add, drag, move, remove, project (WP-632). The fake is strict: a
// marker needs a map, and every call the layer makes must be one MapLibre has.
import { describe, expect, it } from 'vitest';
import type { Position } from '@ueberblick/core/geo';
import type { MaplibreApi, MlMap, MlMarker } from './api';
import { createMarkerLayer } from './marker';
import { mount, tick, styled } from './renderer-fixture';

function fakeApi() {
  const live = new Map<MlMarker, { draggable: boolean; at: [number, number] }>();
  const handlers = new Map<MlMarker, Map<string, () => void>>();
  class FakeMarker implements MlMarker {
    constructor(o: { element: HTMLElement; draggable?: boolean; anchor?: 'center' }) {
      if (o.anchor !== 'center') throw new Error('the pin is anchored on its middle');
      live.set(this, { draggable: o.draggable === true, at: [0, 0] });
      handlers.set(this, new Map());
    }
    setLngLat(at: [number, number]) {
      const m = live.get(this);
      if (m === undefined) throw new Error('marker removed');
      m.at = at;
      return this;
    }
    getLngLat() {
      const at = live.get(this)?.at ?? [0, 0];
      return { lng: at[0], lat: at[1] };
    }
    addTo() {
      return this;
    }
    on(type: 'drag' | 'dragend', l: () => void) {
      handlers.get(this)?.set(type, l);
      // MapLibre's `on` returns a subscription, never the marker (the chained call crashed in the real library)
      return { unsubscribe() {} };
    }
    remove() {
      live.delete(this);
      return this;
    }
  }
  const map = {} as MlMap;
  const api = { Marker: FakeMarker } as unknown as MaplibreApi;
  const drag = (to: [number, number], end = false) => {
    const [mk] = [...live.keys()];
    if (mk === undefined) throw new Error('no marker');
    const m = live.get(mk);
    if (m !== undefined) m.at = to;
    handlers.get(mk)?.get('drag')?.();
    if (end) handlers.get(mk)?.get('dragend')?.();
  };
  return { api, map, live, drag };
}

const el = () => document.createElement('div');

describe('marker layer', () => {
  it('adds a draggable marker at a position and reads it back', () => {
    const f = fakeApi();
    const layer = createMarkerLayer(() => undefined);
    layer.attach(f.api, f.map);
    layer.add('pin', [7, 50], { element: el(), draggable: true });
    expect(layer.position('pin')).toEqual([7, 50]);
    expect([...f.live.values()][0]?.draggable).toBe(true);
  });

  it('a drag reports the new position on every move and at its end', () => {
    const f = fakeApi();
    const seen: [string, Position][] = [];
    const layer = createMarkerLayer((id, at) => seen.push([id, at]));
    layer.attach(f.api, f.map);
    layer.add('pin', [7, 50], { element: el(), draggable: true });
    f.drag([7.1, 50.1]);
    f.drag([7.2, 50.2], true);
    expect(seen).toEqual([
      ['pin', [7.1, 50.1]],
      ['pin', [7.2, 50.2]],
      ['pin', [7.2, 50.2]],
    ]);
    expect(layer.position('pin')).toEqual([7.2, 50.2]);
  });

  it('move places the marker without firing a drag; an unknown id is ignored', () => {
    const f = fakeApi();
    const seen: string[] = [];
    const layer = createMarkerLayer((id) => seen.push(id));
    layer.attach(f.api, f.map);
    layer.add('pin', [7, 50], { element: el() });
    layer.move('pin', [8, 51]);
    layer.move('nope', [1, 1]);
    expect(layer.position('pin')).toEqual([8, 51]);
    expect([...f.live.values()][0]?.at).toEqual([8, 51]);
    expect(seen).toEqual([]);
  });

  it('the same id replaces the marker; remove drops it', () => {
    const f = fakeApi();
    const layer = createMarkerLayer(() => undefined);
    layer.attach(f.api, f.map);
    layer.add('pin', [7, 50], { element: el() });
    layer.add('pin', [9, 52], { element: el() });
    expect(f.live.size).toBe(1);
    layer.remove('pin');
    layer.remove('pin');
    expect(f.live.size).toBe(0);
    expect(layer.position('pin')).toBeUndefined();
  });

  it('markers added before the map exists appear when it attaches, and dispose removes them', () => {
    const f = fakeApi();
    const layer = createMarkerLayer(() => undefined);
    layer.add('pin', [7, 50], { element: el(), draggable: true });
    expect(f.live.size).toBe(0);
    expect(layer.position('pin')).toEqual([7, 50]);
    layer.attach(f.api, f.map);
    expect(f.live.size).toBe(1);
    layer.dispose();
    expect(f.live.size).toBe(0);
  });
});

describe('the renderer handle', () => {
  it('projects and unprojects through the map and rings onMove on every move', async () => {
    const { handle, calls } = mount(undefined, styled);
    expect(handle.project([1, 2])).toBeUndefined();
    await handle.ready;
    await tick();
    expect(handle.project([7, 50])).toEqual({ x: 70, y: 500 });
    expect(handle.unproject({ x: 70, y: 500 })).toEqual([7, 50]);
    let moves = 0;
    const off = handle.onMove(() => moves++);
    calls.handlers.get('move')?.();
    calls.handlers.get('move')?.();
    off();
    calls.handlers.get('move')?.();
    expect(moves).toBe(2);
  });

  it('a marker dragged on the map reaches onMarkerDrag and touches no feature source', async () => {
    const { handle, calls } = mount(undefined, styled);
    await handle.ready;
    await tick();
    const seen: Position[] = [];
    handle.onMarkerDrag((_id, at) => seen.push(at));
    handle.addMarker('pin', [7, 50], { element: document.createElement('div'), draggable: true });
    const before = calls.setData.length + calls.updateData.length;
    calls.dragMarker([7.5, 50.5]);
    expect(seen).toEqual([[7.5, 50.5]]);
    expect(handle.markerPosition('pin')).toEqual([7.5, 50.5]);
    expect(calls.setData.length + calls.updateData.length).toBe(before);
    handle.removeMarker('pin');
    expect(handle.markerPosition('pin')).toBeUndefined();
  });

  it('a dashed overlay line is drawn by its own layer', async () => {
    const { handle, calls } = mount(undefined, styled);
    await handle.ready;
    await tick();
    handle.showOverlay(
      'link',
      {
        type: 'LineString',
        coordinates: [
          [7, 50],
          [8, 51],
        ],
      },
      { color: '#d00', dashed: true, opacity: 0.7 },
    );
    const last = calls.setData[calls.setData.length - 1];
    expect(last?.features[0]?.properties).toMatchObject({ dashed: true, opacity: 0.7 });
    expect(calls.layers).toContain('ub-overlay-dash');
  });
});
