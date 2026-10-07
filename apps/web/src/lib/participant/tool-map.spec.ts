// @vitest-environment jsdom
// Measure and Search over the real tool port (WP-576): the panel mounts the tool, the port is `mapToolPort` over a
// map handle, and the handle records what the tool asked of the map. The e2e cannot show this yet: the golden layers
// are `$ref` styles nothing resolves (WP-577), so no map mounts there.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { Geometry, Position } from '@ueberblick/core/geo';
import { createGeo } from '@ueberblick/core/geo';
import type { FeatureId } from '@ueberblick/core/model';
import type { CenterOptions, MapHandle, OverlayStyle } from '@ueberblick/ui';
import type { Device } from './device';
import { mapToolPort } from './map-view';
import ToolPanel from './ToolPanel.svelte';

const style: OverlayStyle = { color: '#1b5e3b' };

function fakeHandle() {
  const taps = new Set<(at: Position) => void>();
  const overlays = new Map<string, Geometry>();
  const centred: [Position | readonly number[], CenterOptions | undefined][] = [];
  const handle = {
    onMapTap: (l: (at: Position) => void) => {
      taps.add(l);
      return () => void taps.delete(l);
    },
    centerOn: (t: Position, o?: CenterOptions) => void centred.push([t, o]),
    showOverlay: (id: string, g: Geometry) => void overlays.set(id, g),
    clearOverlay: (id: string) => void overlays.delete(id),
    extent: () => [7, 50, 8, 51],
  } as unknown as MapHandle;
  return { handle, taps, overlays, centred, tap: (p: Position) => taps.forEach((l) => l(p)) };
}

function device(): Device {
  return {
    geo: createGeo(),
    blobs: { put: async () => undefined },
    config: { file: { tools: { search: { sources: ['baum.art'] } } }, foldTypes: new Map() },
    searchText: () => ['t1' as FeatureId],
    feature: () => ({ id: 't1', type: 'baum', properties: { art: 'Linde' } }),
  } as unknown as Device;
}

afterEach(() => document.body.replaceChildren());

const props = (toolKey: string, port: ReturnType<typeof mapToolPort>['port']) => ({
  device: device(),
  toolKey,
  label: toolKey,
  locale: 'en' as const,
  map: port,
  onstartTask: vi.fn(),
  onopenFeature: vi.fn(),
  onclose: vi.fn(),
});

describe('a tool panel that is a side sheet', () => {
  it('does not lock the rest of the shell (v3: the bar stays usable beside any sheet)', async () => {
    render(ToolPanel, props('search', mapToolPort(fakeHandle().handle, style).port));
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.style.pointerEvents).not.toBe('none');
  });
});

describe('Measure over the participant map port', () => {
  it('two tapped points are measured and drawn as one overlay line, cleared when the panel closes', async () => {
    const m = fakeHandle();
    const { unmount } = render(ToolPanel, props('measure', mapToolPort(m.handle, style).port));
    await waitFor(() => expect(m.taps.size).toBe(1));
    m.tap([9, 48]);
    m.tap([9.0013, 48]);
    await waitFor(() =>
      expect(m.overlays.get('tool')).toEqual({
        type: 'LineString',
        coordinates: [
          [9, 48],
          [9.0013, 48],
        ],
      }),
    );
    expect(document.body.textContent).toMatch(/\d+(\.\d)? m/);
    unmount();
    await waitFor(() => expect(m.taps.size).toBe(0));
    expect(m.overlays.has('tool')).toBe(false);
  });

  it('without a map Measure is not hostable', () => {
    expect(mapToolPort(undefined, style).canTap).toBe(false);
    expect(mapToolPort(fakeHandle().handle, style).canTap).toBe(true);
  });
});

describe('Search over the participant map port', () => {
  it('shows the panel; the port centres the handle (zoom passed as an option)', async () => {
    const m = fakeHandle();
    const { port } = mapToolPort(m.handle, style);
    render(ToolPanel, props('search', port));
    await screen.findByRole('dialog');
    port.centerOn([9.3, 48.4], 17);
    expect(m.centred).toEqual([[[9.3, 48.4], { zoom: 17 }]]);
  });
});

describe('the panel of a tool that reads map taps (WP-585)', () => {
  it('Measure is not modal (no scrim over the map, so taps reach it); Search is a side sheet with no scrim either', async () => {
    const port = mapToolPort(fakeHandle().handle, style).port;
    const measure = render(ToolPanel, props('measure', port));
    await screen.findByRole('dialog', { name: 'measure' });
    expect(screen.queryByTestId('sheet-backdrop')).toBeNull();
    measure.unmount();
    render(ToolPanel, props('search', port));
    await screen.findByRole('dialog');
    expect(screen.queryByTestId('sheet-backdrop')).toBeNull();
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull();
  });
});
