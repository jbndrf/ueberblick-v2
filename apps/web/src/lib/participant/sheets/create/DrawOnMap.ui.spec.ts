// @vitest-environment jsdom
// WP-635: the + flow for a line or an area type: the picker offers it, the map is drawn on, Fertig starts the form with
// the drawn geometry (v3 `WorkflowSelector` -> `geometry-draw-tool` -> `onWorkflowSelect`).
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { axeViolations } from '@ueberblick/ui/testing';
import { createGeo, type Position } from '@ueberblick/core/geo';
import type { MapHandle } from '@ueberblick/ui';
import CreateFlow from './CreateFlow.svelte';
import type { Pill } from './creatable';

const pills: Pill[] = [
  { taskKey: 'hecke', label: 'Hecke erfassen', onMap: false, draw: { kind: 'linestring', multi: true } },
  { taskKey: 'flaeche', label: 'Fläche erfassen', onMap: false, draw: { kind: 'polygon', multi: false } },
  { taskKey: 'baum', label: 'Baum erfassen', onMap: true },
];

function fakeMap() {
  const taps = new Set<(p: Position) => void>();
  const drags = new Set<(id: string, p: Position) => void>();
  const markers = new Map<string, { at: Position; options: { element: HTMLElement; draggable?: boolean } }>();
  const overlays = new Map<string, { geometry: unknown; style: Record<string, unknown> }>();
  const zoomCalls: boolean[] = [];
  const handle = {
    extent: () => [7, 50, 7.2, 50.2],
    onExtentChange: () => () => {},
    onMove: () => () => {},
    onMapTap: (f: (p: Position) => void) => (taps.add(f), () => taps.delete(f)),
    onMarkerDrag: (f: (id: string, p: Position) => void) => (drags.add(f), () => drags.delete(f)),
    addMarker: (id: string, at: Position, options: never) => markers.set(id, { at, options }),
    moveMarker: (id: string, at: Position) => {
      const m = markers.get(id);
      if (m) m.at = at;
    },
    markerPosition: (id: string) => markers.get(id)?.at,
    removeMarker: (id: string) => markers.delete(id),
    showOverlay: (id: string, geometry: never, style: never) => overlays.set(id, { geometry, style }),
    clearOverlay: (id: string) => overlays.delete(id),
    setDoubleClickZoom: (on: boolean) => void zoomCalls.push(on),
  } as unknown as MapHandle;
  // a tap, then the stack re-reads the drawing (Svelte updates the DOM in a microtask)
  const tap = async (...ps: Position[]): Promise<void> => {
    for (const p of ps) taps.forEach((f) => f(p));
    await tick();
  };
  return { handle, markers, overlays, tap, zoomCalls };
}

const A: Position = [7.1, 50.1];
const B: Position = [7.11, 50.1];
const C: Position = [7.11, 50.11];
const D: Position = [7.1, 50.11];

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

describe('+ offers lines and areas and draws them on the map', () => {
  it('the picker lists the line and area types next to the point type', () => {
    flow();
    expect(screen.getAllByTestId('create-pill').map((e) => e.textContent?.trim())).toEqual([
      'Hecke erfassen',
      'Fläche erfassen',
      'Baum erfassen',
    ]);
  });

  it('with no map, the types that need drawing are not offered', () => {
    flow({ handle: undefined });
    expect(screen.getAllByTestId('create-pill').map((e) => e.textContent?.trim())).toEqual(['Baum erfassen']);
  });

  it('an area: tap three vertices, Fertig starts the form with a Polygon', async () => {
    const { map, onstart } = flow();
    await fireEvent.click(screen.getByText('Fläche erfassen'));
    expect(screen.getByTestId('draw-toolbar')).toBeTruthy();
    expect(screen.queryByTestId('create-picker')).toBeNull();
    expect((screen.getByTestId('draw-finish') as HTMLButtonElement).disabled).toBe(true);
    await map.tap(A, B, C);
    expect((screen.getByTestId('draw-finish') as HTMLButtonElement).disabled).toBe(false);
    expect(map.markers.size).toBe(3);
    await fireEvent.click(screen.getByTestId('draw-finish'));
    expect(onstart).toHaveBeenCalledTimes(1);
    const [task, geometry] = onstart.mock.calls[0] as [string, { type: string; coordinates: number[][][] }];
    expect(task).toBe('flaeche');
    expect(geometry.type).toBe('Polygon');
    expect(geometry.coordinates[0]).toHaveLength(4);
    expect(map.markers.size).toBe(0);
    expect(map.overlays.size).toBe(0);
  });

  it('a single-part type has no Neues Element and no part tabs', async () => {
    const { map } = flow();
    await fireEvent.click(screen.getByText('Fläche erfassen'));
    await map.tap(A, B, C);
    expect(screen.queryByTestId('draw-new-part')).toBeNull();
    expect(screen.queryAllByTestId('draw-part')).toHaveLength(0);
  });

  it('a multi-part line: Neues Element, a second part, Rückgängig, Fertig gives a MultiLineString', async () => {
    const { map, onstart } = flow();
    await fireEvent.click(screen.getByText('Hecke erfassen'));
    await map.tap(A);
    await map.tap(B);
    await fireEvent.click(screen.getByTestId('draw-new-part'));
    expect(screen.getAllByTestId('draw-part')).toHaveLength(2);
    await map.tap(C);
    await map.tap(D);
    await map.tap([7.12, 50.12]);
    await fireEvent.click(screen.getByTestId('draw-undo'));
    await fireEvent.click(screen.getByTestId('draw-finish'));
    expect(onstart).toHaveBeenCalledWith('hecke', {
      type: 'MultiLineString',
      coordinates: [
        [A, B],
        [C, D],
      ],
    });
  });

  it('Rückgängig and Wiederherstellen only show when there is something to undo or redo', async () => {
    const { map } = flow();
    await fireEvent.click(screen.getByText('Hecke erfassen'));
    expect(screen.queryByTestId('draw-undo')).toBeNull();
    await map.tap(A);
    expect(screen.getByTestId('draw-undo')).toBeTruthy();
    expect(screen.queryByTestId('draw-redo')).toBeNull();
    await fireEvent.click(screen.getByTestId('draw-undo'));
    expect(screen.getByTestId('draw-redo')).toBeTruthy();
  });

  it('a self-intersecting area is refused with the reason, and the drawing stays', async () => {
    const { map, onstart } = flow();
    await fireEvent.click(screen.getByText('Fläche erfassen'));
    await map.tap(A, C, B, D);
    await fireEvent.click(screen.getByTestId('draw-finish'));
    expect(onstart).not.toHaveBeenCalled();
    expect(screen.getByTestId('draw-refused').textContent).toBe(
      'Nicht übernommen: die Form überschneidet sich selbst.',
    );
    expect(map.markers.size).toBe(4);
  });

  it('double-click zoom is off while drawing and back on after Fertig and after Abbrechen', async () => {
    const a = flow();
    await fireEvent.click(screen.getByText('Fläche erfassen'));
    expect(a.map.zoomCalls).toEqual([false]);
    await a.map.tap(A, B, C);
    await fireEvent.click(screen.getByTestId('draw-finish'));
    expect(a.map.zoomCalls).toEqual([false, true]);
    a.unmount();
    const b = flow();
    await fireEvent.click(screen.getByText('Hecke erfassen'));
    await fireEvent.click(screen.getByTestId('draw-cancel'));
    expect(b.map.zoomCalls).toEqual([false, true]);
  });

  it('the cross cancels, leaving nothing on the map and starting nothing', async () => {
    const { map, onstart, onclose } = flow();
    await fireEvent.click(screen.getByText('Hecke erfassen'));
    await map.tap(A);
    await map.tap(B);
    await fireEvent.click(screen.getByTestId('draw-cancel'));
    expect(onstart).not.toHaveBeenCalled();
    expect(onclose).toHaveBeenCalled();
    expect(map.markers.size).toBe(0);
    expect(map.overlays.size).toBe(0);
  });

  it('labels come from the catalogue, in English too', async () => {
    flow({ locale: 'en' });
    await fireEvent.click(screen.getByText('Hecke erfassen'));
    for (const name of ['Cancel', 'New part', 'Delete part', 'Done', 'Part 1'])
      expect(screen.getByLabelText(name)).toBeTruthy();
  });

  it('has no axe violations while drawing', async () => {
    const { map, container } = flow();
    await fireEvent.click(screen.getByText('Hecke erfassen'));
    await map.tap(A);
    await map.tap(B);
    expect(await axeViolations(container)).toEqual([]);
  });
});
