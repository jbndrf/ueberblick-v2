// @vitest-environment jsdom
// The `tools` slot: v3's Werkzeuge sheet over the person's tools. A tile opens the tool's panel (Measure on the map
// without a scrim, Search in a sheet), the list standing in for the map takes Measure away, and an empty sheet says so.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import { createGeo, type Geometry, type Position } from '@ueberblick/core/geo';
import type { FeatureId } from '@ueberblick/core/model';
import type { MapHandle } from '@ueberblick/ui';
import { createPrefsClient } from '@ueberblick/client';
import type { Device } from '../../device';
import type { ShellContext } from '../../shell/sheets';
import { toolEntries } from '../../tools/entries';
import { createChatLink } from '../../tools/chat-link';
import { createToolPerson } from '../../tools/person';
import ToolsSlot from './ToolsSlot.svelte';

afterEach(cleanup);

const file = {
  roles: { kontrolle: { label: 'K', app: { tools: { measure: {}, search: { availability: 'offered' } } } } },
  tools: { measure: {}, search: { sources: ['baum.art'] } },
} as never;

function fakeMap() {
  const taps = new Set<(at: Position) => void>();
  const overlays = new Map<string, Geometry>();
  const handle = {
    onMapTap: (l: (at: Position) => void) => (taps.add(l), () => void taps.delete(l)),
    centerOn: vi.fn(),
    showOverlay: (id: string, g: Geometry) => void overlays.set(id, g),
    clearOverlay: (id: string) => void overlays.delete(id),
    extent: () => [7, 50, 8, 51],
  } as unknown as MapHandle;
  return { handle, taps, overlays };
}

function ctxOf(over: Partial<ShellContext> = {}, switches: Record<string, boolean> = {}): ShellContext {
  const store = new Map<string, string>();
  const prefs = createPrefsClient({
    storage: {
      get: (k) => store.get(k) ?? null,
      set: (k, v) => void store.set(k, v),
      remove: (k) => void store.delete(k),
    },
    transport: {
      fetch: () => Promise.reject(new Error('offline')),
      send: () => Promise.reject(new Error('offline')),
    },
    clock: { now: () => new Date().toISOString() },
    project: 'p',
    participant: 'u',
  });
  for (const [k, v] of Object.entries(switches)) prefs.set(`tools.${k}`, v);
  const person = createToolPerson({ file, roleKey: 'kontrolle', prefs });
  const device = {
    project: 'p',
    roleKey: 'kontrolle',
    geo: createGeo(),
    blobs: { put: async () => undefined },
    config: { file, foldTypes: new Map() },
    problems: { list: () => [] },
    searchText: () => [],
    feature: () => undefined,
    toolBadges: { current: () => ({}), subscribe: () => () => undefined },
    chat: createChatLink(),
  } as unknown as Device;
  return {
    device,
    locale: 'en',
    online: true,
    map: undefined,
    center: () => undefined,
    openFeature: vi.fn(),
    tools: { entries: toolEntries(file, 'kontrolle', switches), person },
    ...over,
  } as unknown as ShellContext;
}

describe('ToolsSlot', () => {
  it('lists the tools that are on, as v3 tiles: an offered tool is absent until the person switches it on', () => {
    render(ToolsSlot, { ctx: ctxOf({ map: fakeMap().handle }), onclose: vi.fn() });
    expect(screen.getByRole('button', { name: 'Measure' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
    cleanup();
    render(ToolsSlot, { ctx: ctxOf({ map: fakeMap().handle }, { search: true }), onclose: vi.fn() });
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
  });

  it('Measure opens on the map without a scrim: the sheet closes, its tool reads the taps and draws', async () => {
    const m = fakeMap();
    const onclose = vi.fn();
    render(ToolsSlot, { ctx: ctxOf({ map: m.handle }), onclose });
    await fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    await screen.findByRole('dialog', { name: 'Measure' });
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
    expect(screen.queryByTestId('sheet-backdrop')).toBeNull();
    await waitFor(() => expect(m.taps.size).toBe(1));
    m.taps.forEach((l) => {
      l([9, 48]);
      l([9.0013, 48]);
    });
    await waitFor(() => expect(m.overlays.get('tool')).toBeDefined());
    expect(onclose).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('Search opens in a side sheet; picking a result opens its feature and closes the slot', async () => {
    const onclose = vi.fn();
    const ctx = ctxOf(
      {
        map: fakeMap().handle,
        device: {
          ...ctxOf().device,
          searchText: () => ['t1' as FeatureId],
          feature: () => ({ id: 't1', type: 'baum', lifecycle: 'active', properties: { art: 'Linde' } }),
        } as unknown as Device,
      },
      { search: true },
    );
    render(ToolsSlot, { ctx, onclose });
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('dialog', { name: 'Search' });
    expect(screen.queryByTestId('sheet-backdrop')).toBeNull();
    await fireEvent.input(await screen.findByRole('searchbox'), { target: { value: 'Linde' } });
    await fireEvent.click(await screen.findByRole('button', { name: /Linde/ }));
    expect(ctx.openFeature).toHaveBeenCalledWith('t1');
    expect(onclose).toHaveBeenCalled();
  });

  it('while the list stands in for the map, Measure is not offered', () => {
    render(ToolsSlot, { ctx: ctxOf({ map: undefined }, { search: true }), onclose: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Measure' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
  });

  it('with no tool on it says so, and closing the sheet closes the slot', async () => {
    const onclose = vi.fn();
    const ctx = ctxOf({ map: undefined }, { measure: false });
    render(ToolsSlot, { ctx, onclose });
    expect(screen.getByText('No tools are active for this project.')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onclose).toHaveBeenCalled();
  });
});
