// @vitest-environment jsdom
// WP-711: the Liste of the map canvas. It reads the extent of the map while the map is visible (padded), never the
// collapsed one of a map hidden behind it, and shows one table per Objektart.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@ueberblick/ui';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Device } from '../device';
import { createFilterController } from '../sheets/filter/filter-controller';
import { createLayerController } from '../sheets/layer/layer-controller';
import { memoryChoice } from '../sheets/layer/layer-prefs.testing';
import type { Prefs } from '@ueberblick/core/prefs';
import { padExtent } from './extent';

vi.mock('maplibre-gl', () => ({ setWorkerUrl: () => undefined }));
const state = vi.hoisted(() => ({
  listeners: [] as ((e: readonly number[]) => void)[],
  current: [7, 50, 8, 51] as readonly number[],
}));
vi.mock('@ueberblick/ui', async (importOriginal) => {
  const real = await importOriginal<typeof Ui>();
  const handle = {
    ready: Promise.resolve(),
    onFeatureTap: () => () => undefined,
    onExtentChange: (l: (e: readonly number[]) => void) => (state.listeners.push(l), () => undefined),
    extent: () => state.current,
    setBasemaps: () => undefined,
    setZoomBounds: () => undefined,
    destroy: () => undefined,
  };
  return { ...real, createRendererMap: () => new Map([['maplibre-2d', { mount: () => handle }]]) };
});
const { default: MapCanvas } = await import('../shell/MapCanvas.svelte');

const seen: (readonly number[] | undefined)[] = [];
const rowsOf = [
  { id: 'v1', name: 'Markt', properties: { titel: 'Markt', datum: '2026-11-03' } },
  { id: 'v2', name: 'Fest', properties: { titel: 'Fest', datum: '2026-11-04' } },
  { id: 'g1', name: 'Gebäude #0009', properties: {} },
];
const typeOfId: Record<string, string> = { v1: 'ver', v2: 'ver', g1: 'geb' };
const device = {
  get classified() {
    return (this as { config: never }).config;
  },
  config: {
    file: {
      types: {
        ver: {
          label: { en: 'Event' },
          properties: {
            titel: { type: 'text', label: { en: 'Title' } },
            datum: { type: 'date', label: { en: 'Date' } },
          },
        },
        geb: { label: { en: 'Building' }, properties: {} },
      },
      views: {
        karte: { source: { type: 'ver' }, layers: { l: { renderer: 'maplibre-2d', style: { layers: [] } } } },
      },
    },
  },
  viewSource: () => ({ query: () => [], subscribe: () => () => undefined }),
  viewList: () => ({
    rowChunks: function* (e?: readonly number[]) {
      seen.push(e);
      yield rowsOf;
    },
    rename: (rows: readonly { id: string; name: string }[], locales: readonly string[]) =>
      rows.map((r) =>
        r.id === 'g1' ? { ...r, name: locales[0] === 'de' ? 'Gebäude #0009' : 'Building #0009' } : r,
      ),
  }),
  feature: (id: string) => ({ id, type: typeOfId[id] }),
  changed: { subscribe: () => () => undefined },
  problems: { report: () => undefined },
} as unknown as Device;

const props = () => ({
  device,
  filter: createFilterController(),
  layers: createLayerController({ map: undefined, store: memoryChoice() }),
  record: {
    current: (): Prefs => ({
      tools: {},
      tool_prefs: {},
      filters: { saved: [], active: null, hidden: null },
      ui: {},
    }),
  },
  viewKey: 'karte',
  locale: 'en' as const,
  theme: 'normal' as const,
  onfeature: () => undefined,
  onhandle: () => undefined,
});

afterEach(() => {
  cleanup();
  state.listeners.length = 0;
  state.current = [7, 50, 8, 51];
  seen.length = 0;
});

describe('MapCanvas: the Liste (WP-711)', () => {
  it('filters by the visible extent, padded so a marker on the edge is listed', async () => {
    render(MapCanvas, props());
    await waitFor(() => expect(state.listeners.length).toBeGreaterThan(0)); // the map is up
    await fireEvent.click(await screen.findByRole('button', { name: 'List' }));
    expect(seen.at(-1)).toEqual(padExtent([7, 50, 8, 51]));
  });

  it('re-labels the rows when the locale changes, without reading the facts again (WP-761)', async () => {
    const view = render(MapCanvas, props());
    await waitFor(() => expect(state.listeners.length).toBeGreaterThan(0));
    await fireEvent.click(await screen.findByRole('button', { name: 'List' }));
    expect(await screen.findByText('Building #0009', { selector: 'button' })).toBeTruthy();
    const reads = seen.length;
    await view.rerender({ ...props(), locale: 'de' });
    expect(await screen.findByText('Gebäude #0009', { selector: 'button' })).toBeTruthy();
    expect(seen.length).toBe(reads);
  });

  it('keeps that extent when the map, hidden behind the Liste, reports a collapsed one: never zero rows', async () => {
    render(MapCanvas, props());
    await waitFor(() => expect(state.listeners.length).toBeGreaterThan(0)); // the map is up
    await fireEvent.click(await screen.findByRole('button', { name: 'List' }));
    state.current = [7.5, 50.5, 7.5, 50.5];
    for (const l of state.listeners) l(state.current);
    expect(seen.at(-1)).toEqual(padExtent([7, 50, 8, 51]));
    expect(await screen.findByText('Markt', { selector: 'button' })).toBeTruthy();
    expect(screen.queryByText('No features in this extent.')).toBeNull();
  });

  it('shows one table per Objektart and no column that repeats the name', async () => {
    render(MapCanvas, props());
    await waitFor(() => expect(state.listeners.length).toBeGreaterThan(0)); // the map is up
    await fireEvent.click(await screen.findByRole('button', { name: 'List' }));
    await waitFor(() => expect(screen.getAllByRole('table')).toHaveLength(2));
    expect(screen.getByRole('table', { name: 'Building (1)' })).toBeTruthy();
    const events = screen.getByRole('table', { name: 'Event (2)' });
    expect([...events.querySelectorAll('th')].map((h) => h.textContent?.trim())).toEqual(['Event', 'Date']);
  });
});
