// @vitest-environment jsdom
// WP-636: the map side of a location step. A point property is moved with the pin and the confirm pill, a line or an
// area is redrawn with the draw tool; the result (or cancel) goes back to the step.
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { createGeo, type Position } from '@ueberblick/core/geo';
import type { MapHandle } from '@ueberblick/ui';
import { drawSpecOf } from '../sheets/create/creatable';
import LocationPick from './LocationPick.svelte';

function fakeMap() {
  const taps = new Set<(p: Position) => void>();
  const markers = new Map<string, Position>();
  const capture: boolean[] = [];
  const centered: unknown[] = [];
  const handle = {
    extent: () => [7, 50, 7.2, 50.2],
    onExtentChange: () => () => {},
    onMove: () => () => {},
    onMapTap: (f: (p: Position) => void) => (taps.add(f), () => taps.delete(f)),
    onMarkerDrag: () => () => {},
    addMarker: (id: string, at: Position) => markers.set(id, at),
    moveMarker: (id: string, at: Position) => markers.set(id, at),
    markerPosition: (id: string) => markers.get(id),
    removeMarker: (id: string) => markers.delete(id),
    showOverlay: () => {},
    clearOverlay: () => {},
    setDoubleClickZoom: () => {},
    captureTaps: (on: boolean) => void capture.push(on),
    centerOn: (target: unknown, opts: unknown) => void centered.push([target, opts]),
  } as unknown as MapHandle;
  const tap = async (...ps: Position[]): Promise<void> => {
    for (const p of ps) taps.forEach((f) => f(p));
    await tick();
  };
  return { handle, markers, tap, capture, centered };
}

function pick(kind: string | undefined, current?: never) {
  const map = fakeMap();
  const ondone = vi.fn();
  render(LocationPick, {
    handle: map.handle,
    geo: createGeo(),
    locale: 'de',
    label: 'Verschieben',
    draw: drawSpecOf(kind),
    ...(current === undefined ? {} : { current }),
    ondone,
  });
  return { map, ondone };
}

describe('location pick', () => {
  it('a point: the pill confirms the pin, which starts at the middle of the map', async () => {
    const { ondone, map } = pick('point');
    expect(screen.getByTestId('placement-confirm').textContent).toContain('Verschieben');
    expect(map.markers.get('placement-pin')).toEqual([7.1, 50.1]);
    await fireEvent.click(screen.getByTestId('placement-confirm'));
    expect(ondone).toHaveBeenCalledWith({ type: 'Point', coordinates: [7.1, 50.1] });
  });

  it('a tap on the map moves the pin; the cross cancels with no result', async () => {
    const { ondone, map } = pick('point');
    await map.tap([7.15, 50.15]);
    await fireEvent.click(screen.getByTestId('placement-confirm'));
    expect(ondone).toHaveBeenLastCalledWith({ type: 'Point', coordinates: [7.15, 50.15] });
    const second = pick('point');
    await fireEvent.click(screen.getAllByTestId('placement-cancel').at(-1) as HTMLElement);
    expect(second.ondone).toHaveBeenCalledWith(undefined);
  });

  // WP-698: a tree inside an area. The map would hand the tap to the area; the pin owns the tap (v3 isEditingLocation).
  it('the pin owns the map tap while it is up, so a tree inside an area can be moved', () => {
    const { map } = pick('point');
    expect(map.capture).toEqual([true]);
    cleanup();
    expect(map.capture).toEqual([true, false]);
  });

  it('the draw tool owns the map tap while it is up', () => {
    const { map } = pick('linestring');
    expect(map.capture).toEqual([true]);
    cleanup();
    expect(map.capture).toEqual([true, false]);
  });

  it('a multi-part line is redrawn with the draw tool and comes back as a MultiLineString', async () => {
    const { ondone, map } = pick('multilinestring');
    await map.tap([7.1, 50.1]);
    await map.tap([7.11, 50.1]);
    await fireEvent.click(screen.getByTestId('draw-new-part'));
    await map.tap([7.11, 50.11]);
    await map.tap([7.1, 50.11]);
    await fireEvent.click(screen.getByTestId('draw-finish'));
    expect(ondone).toHaveBeenCalledWith({
      type: 'MultiLineString',
      coordinates: [
        [
          [7.1, 50.1],
          [7.11, 50.1],
        ],
        [
          [7.11, 50.11],
          [7.1, 50.11],
        ],
      ],
    });
  });

  it('cancelling an area gives no result', async () => {
    const { ondone } = pick('polygon');
    await fireEvent.click(screen.getByTestId('draw-cancel'));
    expect(ondone).toHaveBeenCalledWith(undefined);
  });

  // WP-730: the camera goes to the feature (v3 starts the pin there; the zoom is v4's feature-level one)
  it('a move task: the camera goes to the stored point at the feature-level zoom', () => {
    const { map } = pick('point', { type: 'Point', coordinates: [7.03, 50.04] } as never);
    expect(map.centered).toEqual([[[7.03, 50.04], { minZoom: 16 }]]);
  });

  it('a redraw: the camera fits the stored shape', () => {
    const line = {
      type: 'LineString',
      coordinates: [
        [7.01, 50.01],
        [7.03, 50.04],
      ],
    };
    const { map } = pick('linestring', line as never);
    expect(map.centered).toEqual([[[7.01, 50.01, 7.03, 50.04], {}]]);
  });

  it('a new feature (no stored geometry): the camera stays', () => {
    const { map } = pick('point');
    expect(map.centered).toEqual([]);
  });

  it('a move task: the pin starts at the stored point, not the middle of the map (WP-687)', async () => {
    const { ondone, map } = pick('point', { type: 'Point', coordinates: [7.03, 50.04] } as never);
    expect(map.markers.get('placement-pin')).toEqual([7.03, 50.04]);
    await fireEvent.click(screen.getByTestId('placement-confirm'));
    expect(ondone).toHaveBeenCalledWith({ type: 'Point', coordinates: [7.03, 50.04] });
  });

  it('a move task: the stored area is loaded and confirms unchanged (WP-687)', async () => {
    const ring = [
      [7.1, 50.1],
      [7.11, 50.1],
      [7.11, 50.11],
      [7.1, 50.1],
    ];
    const { ondone, map } = pick('polygon', { type: 'Polygon', coordinates: [ring] } as never);
    expect(map.markers.size).toBe(3);
    await fireEvent.click(screen.getByTestId('draw-finish'));
    expect(ondone).toHaveBeenCalledTimes(1);
    expect((ondone.mock.calls[0]?.[0] as { type: string }).type).toBe('Polygon');
  });
});
