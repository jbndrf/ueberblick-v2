// @vitest-environment jsdom
// WP-677 (B-019): "Mit Eltern-Element verketten" while a pin is placed (v3 WorkflowSelector :279-340), and the parent pick
// of a type that sits at its parent (no pin). Chip, hint, candidate rings, the pin that snaps onto the parent, the dotted
// line, and the form that starts with the parent linked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { axeViolations } from '@ueberblick/ui/testing';
import { createGeo, type Position } from '@ueberblick/core/geo';
import type { FeatureId } from '@ueberblick/core/model';
import type { MapHandle, MarkerOptions } from '@ueberblick/ui';
import type { Candidate } from '../../create/chain';
import CreateFlow from './CreateFlow.svelte';
import type { Pill } from './creatable';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const RELATION = { property: 'gebiet', parentType: 'gebiet' };
const cand = (n: number, at: Position): Candidate => ({
  id: `g${n}` as FeatureId,
  label: `Gebiet ${n}`,
  at,
  relation: RELATION,
});
const CANDIDATES = [cand(1, [7.12, 50.11]), cand(2, [7.2, 50.2])];

function fakeMap() {
  const markers = new Map<string, { at: Position; el: HTMLElement }>();
  const overlays = new Map<string, unknown>();
  const handle = {
    extent: () => [7, 50, 7.3, 50.3],
    onExtentChange: () => () => {},
    onMove: () => () => {},
    onMapTap: () => () => {},
    onMarkerDrag: () => () => {},
    addMarker: (id: string, at: Position, o: MarkerOptions) => {
      markers.set(id, { at, el: o.element });
      document.body.appendChild(o.element);
    },
    moveMarker: (id: string, at: Position) => {
      const m = markers.get(id);
      if (m) m.at = at;
    },
    removeMarker: (id: string) => {
      markers.get(id)?.el.remove();
      markers.delete(id);
    },
    markerPosition: (id: string) => markers.get(id)?.at,
    showOverlay: (id: string, g: unknown) => overlays.set(id, g),
    clearOverlay: (id: string) => overlays.delete(id),
    unproject: () => [7.1, 50.1],
  } as unknown as MapHandle;
  return { handle, markers, overlays };
}

const baum: Pill = {
  taskKey: 'baum_neu',
  label: 'Baum erfassen',
  onMap: true,
  chain: { relations: [RELATION], inherit: false },
};
const massnahme: Pill = {
  taskKey: 'mass_neu',
  label: 'Maßnahme anlegen',
  onMap: false,
  chain: { relations: [{ property: 'baum', parentType: 'baum' }], inherit: true },
};

function flow(pills: Pill[]) {
  const m = fakeMap();
  const props = {
    pills,
    handle: m.handle,
    locale: 'de' as const,
    geo: createGeo(),
    open: true,
    candidatesOf: vi.fn(() => CANDIDATES),
    onstart: vi.fn(),
    onclose: vi.fn(),
    onplacing: vi.fn(),
  };
  render(CreateFlow, props);
  return { ...m, props };
}
const rings = () => screen.queryAllByTestId('chain-candidate');

describe('Mit Eltern-Element verketten while a pin is placed', () => {
  it('offers the chip, open: no hint and no ring', async () => {
    flow([baum]);
    await fireEvent.click(screen.getByTestId('create-pill'));
    const chip = screen.getByRole('button', { name: 'Mit Eltern-Element verketten' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('Tippe auf das Eltern-Element')).toBeNull();
    expect(rings()).toHaveLength(0);
  });

  it('armed: the hint says what to do and every candidate gets a ring named by it', async () => {
    flow([baum]);
    await fireEvent.click(screen.getByTestId('create-pill'));
    await fireEvent.click(screen.getByRole('button', { name: 'Mit Eltern-Element verketten' }));
    expect(screen.getByRole('status').textContent).toContain('Tippe auf das Eltern-Element');
    expect(rings().map((r) => r.getAttribute('aria-label'))).toEqual([
      'Gebiet 1 als Eltern-Element wählen',
      'Gebiet 2 als Eltern-Element wählen',
    ]);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('a tap on a ring selects the parent and snaps the pin onto it, with the dotted line', async () => {
    const f = flow([baum]);
    await fireEvent.click(screen.getByTestId('create-pill'));
    await fireEvent.click(screen.getByRole('button', { name: 'Mit Eltern-Element verketten' }));
    await fireEvent.click(rings()[0] as HTMLElement);
    expect(f.markers.get('placement-pin')?.at).toEqual([7.12, 50.11]);
    expect(f.overlays.get('placement-link')).toEqual({
      type: 'LineString',
      coordinates: [
        [7.12, 50.11],
        [7.12, 50.11],
      ],
    });
    expect(screen.queryByText('Tippe auf das Eltern-Element')).toBeNull(); // picked: the hint goes
    expect(rings()[0]?.getAttribute('aria-pressed')).toBe('true');
  });

  it('confirm starts the form with the pin at the parent and the parent linked', async () => {
    const f = flow([baum]);
    await fireEvent.click(screen.getByTestId('create-pill'));
    await fireEvent.click(screen.getByRole('button', { name: 'Mit Eltern-Element verketten' }));
    await fireEvent.click(rings()[1] as HTMLElement);
    await fireEvent.click(screen.getByTestId('placement-confirm'));
    expect(f.props.onstart).toHaveBeenCalledWith(
      'baum_neu',
      { type: 'Point', coordinates: [7.2, 50.2] },
      CANDIDATES[1],
    );
  });

  it('closing the chain again is standalone creation: no ring, no line, no parent', async () => {
    const f = flow([baum]);
    await fireEvent.click(screen.getByTestId('create-pill'));
    const chip = screen.getByRole('button', { name: 'Mit Eltern-Element verketten' });
    await fireEvent.click(chip);
    await fireEvent.click(rings()[0] as HTMLElement);
    await fireEvent.click(chip);
    expect(rings()).toHaveLength(0);
    expect(f.overlays.has('placement-link')).toBe(false);
    await fireEvent.click(screen.getByTestId('placement-confirm'));
    expect(f.props.onstart.mock.calls[0]?.[2]).toBeUndefined();
  });

  it('a type with no chain gets no chip', async () => {
    flow([{ taskKey: 'x', label: 'Eintrag', onMap: true }]);
    await fireEvent.click(screen.getByTestId('create-pill'));
    expect(screen.queryByRole('button', { name: 'Mit Eltern-Element verketten' })).toBeNull();
  });
});

describe('a type at its parent: no pin, the parent is picked', () => {
  it('shows the hint and the rings, no chip and no pin; a tap on a parent starts the form with it linked', async () => {
    const f = flow([massnahme]);
    await fireEvent.click(screen.getByTestId('create-pill'));
    expect(screen.queryByTestId('chain-toggle')).toBeNull();
    expect(screen.queryByTestId('placement-confirm')).toBeNull();
    expect(f.markers.has('placement-pin')).toBe(false);
    expect(screen.getByRole('status').textContent).toContain('Tippe auf das Eltern-Element');
    expect(f.props.onplacing).toHaveBeenLastCalledWith(true); // the bar hides, as for a pin
    expect(await axeViolations(document.body)).toEqual([]);
    await fireEvent.click(rings()[0] as HTMLElement);
    expect(f.props.onstart).toHaveBeenCalledWith('mass_neu', undefined, CANDIDATES[0]);
  });

  it('the cancel button leaves the picking', async () => {
    const f = flow([massnahme]);
    await fireEvent.click(screen.getByTestId('create-pill'));
    await fireEvent.click(screen.getByTestId('placement-cancel'));
    expect(f.props.onclose).toHaveBeenCalled();
    expect(rings()).toHaveLength(0);
  });
});
