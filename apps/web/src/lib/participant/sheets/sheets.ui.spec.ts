// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { axeViolations } from '@ueberblick/ui/testing';
import { createGeo } from '@ueberblick/core/geo';
import type { MapHandle } from '@ueberblick/ui';
import CreateFlow from './create/CreateFlow.svelte';
import type { Pill } from './create/creatable';

const pills: Pill[] = [
  { taskKey: 'erfassen', label: 'Baum erfassen', onMap: true },
  { taskKey: 'baumart_anlegen', label: 'Baumart anlegen', onMap: false },
];

/**
 * A map that is a box with a marker API: `move` re-centres it and rings the extent and move listeners, as a pan
 * would; `dragPin` plays the person dragging the marker. Screen px are degrees * 1000 (origin at the box's corner).
 */
function fakeMap(centre: [number, number] = [7.1, 50.7]) {
  let c = centre;
  const extent = (): [number, number, number, number] => [c[0] - 0.01, c[1] - 0.01, c[0] + 0.01, c[1] + 0.01];
  const extentListeners = new Set<() => void>();
  const moveListeners = new Set<() => void>();
  const tapListeners = new Set<(p: [number, number]) => void>();
  const dragListeners = new Set<(id: string, p: [number, number]) => void>();
  const markers = new Map<
    string,
    { at: [number, number]; options: { element: HTMLElement; draggable?: boolean } }
  >();
  const overlays = new Map<
    string,
    { geometry: { coordinates: [number, number][] }; style: Record<string, unknown> }
  >();
  const sub = <T>(set: Set<T>, fn: T) => (set.add(fn), () => set.delete(fn));
  const handle = {
    extent,
    onExtentChange: (fn: () => void) => sub(extentListeners, fn),
    onMove: (fn: () => void) => sub(moveListeners, fn),
    onMapTap: (fn: (p: [number, number]) => void) => sub(tapListeners, fn),
    onMarkerDrag: (fn: (id: string, p: [number, number]) => void) => sub(dragListeners, fn),
    centerOn: (p: [number, number]) => move(p),
    addMarker: (id: string, at: [number, number], options: never) => markers.set(id, { at, options }),
    moveMarker: (id: string, at: [number, number]) => {
      const m = markers.get(id);
      if (m) m.at = at;
    },
    markerPosition: (id: string) => markers.get(id)?.at,
    removeMarker: (id: string) => markers.delete(id),
    project: (p: [number, number]) => ({ x: p[0] * 1000, y: p[1] * 1000 }),
    unproject: (p: { x: number; y: number }) => [p.x / 1000, p.y / 1000],
    showOverlay: (id: string, geometry: never, style: never) => overlays.set(id, { geometry, style }),
    clearOverlay: (id: string) => overlays.delete(id),
  } as unknown as MapHandle;
  const move = (p: [number, number]) => {
    c = p;
    extentListeners.forEach((f) => f());
    moveListeners.forEach((f) => f());
  };
  return {
    handle,
    move,
    markers,
    overlays,
    tap: (p: [number, number]) => tapListeners.forEach((f) => f(p)),
    dragPin: (p: [number, number]) => {
      const m = markers.get('placement-pin');
      if (m) m.at = p;
      dragListeners.forEach((f) => f('placement-pin', p));
    },
  };
}

const flow = (over: Record<string, unknown> = {}) => {
  const map = fakeMap();
  const onstart = vi.fn();
  const onclose = vi.fn();
  const view = render(CreateFlow, {
    pills,
    handle: map.handle,
    locale: 'de',
    geo: createGeo(),
    open: true,
    onstart,
    onclose,
    ...over,
  });
  return { map, onstart, onclose, ...view };
};

describe('the + picker', () => {
  it('shows one pill per creatable type, with the task label', () => {
    flow();
    expect(screen.getAllByTestId('create-pill').map((e) => e.textContent?.trim())).toEqual([
      'Baum erfassen',
      'Baumart anlegen',
    ]);
  });

  it('a type without geometry opens the form at once', async () => {
    const { onstart, onclose } = flow();
    await fireEvent.click(screen.getByText('Baumart anlegen'));
    expect(onstart).toHaveBeenCalledWith('baumart_anlegen', undefined);
    // the host decides what follows (WP-652: it mounts the form in place of the flow), so nothing closes here
    expect(onclose).not.toHaveBeenCalled();
  });

  it('a point type puts a draggable pin at the middle of the map; confirming opens the form at the pin', async () => {
    const { map, onstart } = flow();
    await fireEvent.click(screen.getByText('Baum erfassen'));
    const pin = map.markers.get('placement-pin');
    expect(pin?.at).toEqual([7.1, 50.7]);
    expect(pin?.options.draggable).toBe(true);
    expect(screen.queryByTestId('create-picker')).toBeNull();
    expect(onstart).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByTestId('placement-confirm'));
    expect(onstart).toHaveBeenCalledWith('erfassen', { type: 'Point', coordinates: [7.1, 50.7] });
  });

  it('dragging the pin changes the confirmed point, wherever on the map it is dropped', async () => {
    const { map, onstart } = flow();
    await fireEvent.click(screen.getByText('Baum erfassen'));
    map.dragPin([7.105, 50.693]);
    await fireEvent.click(screen.getByTestId('placement-confirm'));
    expect(onstart).toHaveBeenCalledWith('erfassen', { type: 'Point', coordinates: [7.105, 50.693] });
  });

  it('a tap on the map moves the pin there, and the confirmed point follows', async () => {
    const { map, onstart } = flow();
    await fireEvent.click(screen.getByText('Baum erfassen'));
    map.tap([7.3, 50.8]);
    expect(map.markers.get('placement-pin')?.at).toEqual([7.3, 50.8]);
    await fireEvent.click(screen.getByTestId('placement-confirm'));
    expect(onstart).toHaveBeenCalledWith('erfassen', { type: 'Point', coordinates: [7.3, 50.8] });
  });

  it('moving the map leaves the pin where it was put', async () => {
    const { map, onstart } = flow();
    await fireEvent.click(screen.getByText('Baum erfassen'));
    map.move([7.25, 50.75]);
    await fireEvent.click(screen.getByTestId('placement-confirm'));
    expect(onstart).toHaveBeenCalledWith('erfassen', { type: 'Point', coordinates: [7.1, 50.7] });
  });

  it('a dashed line joins the confirm pill to the pin and follows a drag and a pan', async () => {
    const { map } = flow();
    await fireEvent.click(screen.getByText('Baum erfassen'));
    const line = () => map.overlays.get('placement-connector');
    await vi.waitFor(() => expect(line()).toBeDefined());
    expect(line()?.style).toMatchObject({ dashed: true, opacity: 0.7, width: 2 });
    expect(line()?.geometry.coordinates[1]).toEqual([7.1, 50.7]);
    map.dragPin([7.2, 50.6]);
    await vi.waitFor(() => expect(line()?.geometry.coordinates[1]).toEqual([7.2, 50.6]));
    const before = line()?.geometry.coordinates[0];
    map.move([7.3, 50.9]);
    await vi.waitFor(() => expect(line()?.geometry.coordinates[0]).not.toBe(before));
  });

  it('cancelling removes the pin and the line', async () => {
    const { map } = flow();
    await fireEvent.click(screen.getByText('Baum erfassen'));
    await fireEvent.click(screen.getByTestId('placement-cancel'));
    expect(map.markers.size).toBe(0);
    expect(map.overlays.size).toBe(0);
  });

  it('the cross cancels without starting anything', async () => {
    const { onstart, onclose } = flow();
    await fireEvent.click(screen.getByText('Baum erfassen'));
    await fireEvent.click(screen.getByTestId('placement-cancel'));
    expect(onstart).not.toHaveBeenCalled();
    expect(onclose).toHaveBeenCalled();
  });

  it('the backdrop closes the picker', async () => {
    const { onclose } = flow();
    await fireEvent.click(screen.getByLabelText('Menü schließen'));
    expect(onclose).toHaveBeenCalled();
  });

  it('with no map (the list stands in) a point type opens the form without a position', async () => {
    const { onstart } = flow({ handle: undefined });
    await fireEvent.click(screen.getByText('Baum erfassen'));
    expect(onstart).toHaveBeenCalledWith('erfassen', undefined);
  });

  it('strings come from the catalogue in both languages', async () => {
    flow({ locale: 'en' });
    expect(screen.getByLabelText('Close menu')).toBeTruthy();
    await fireEvent.click(screen.getByText('Baum erfassen'));
    expect(screen.getByLabelText('Cancel')).toBeTruthy();
  });

  it('has no axe violations (picker and pin)', async () => {
    const { container } = flow();
    expect(await axeViolations(container)).toEqual([]);
    await fireEvent.click(screen.getByText('Baum erfassen'));
    expect(await axeViolations(container)).toEqual([]);
  });
});
