// @vitest-environment jsdom
// v3's map screen as a journey: the participant sees the header, the map and the bar; each bar button opens its sheet
// through the registry (and a sheet that is not ported shows nothing, the button stays); Standort centres the map on a
// faked position and says when it cannot; a tap on a feature opens the feature slot with its id.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@ueberblick/ui';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import axe from 'axe-core';
import { deviceOf, memoryPrefs, props, registryOf } from './map-screen.testing';

vi.mock('maplibre-gl', () => ({ setWorkerUrl: () => undefined }));
const map = vi.hoisted(() => ({
  taps: [] as ((id: string) => void)[],
  clusterTaps: [] as ((tap: unknown) => void)[],
  mapTaps: [] as (() => void)[],
  /** When set, the map's `ready` waits for it (the loading state is visible until then). */
  gate: undefined as Promise<void> | undefined,
  centerOn: vi.fn(),
  showOverlay: vi.fn(),
}));
vi.mock('@ueberblick/ui', async (importOriginal) => {
  const real = await importOriginal<typeof Ui>();
  const handle = {
    get ready() {
      return map.gate ?? Promise.resolve();
    },
    onFeatureTap: (l: (id: string) => void) => {
      map.taps.push(l);
      return () => undefined;
    },
    onClusterTap: (l: (tap: unknown) => void) => {
      map.clusterTaps.push(l);
      return () => undefined;
    },
    onMapTap: (l: () => void) => {
      map.mapTaps.push(l);
      return () => undefined;
    },
    onExtentChange: () => () => undefined,
    extent: () => [7, 50, 8, 51],
    centerOn: map.centerOn,
    showOverlay: map.showOverlay,
    destroy: () => undefined,
  };
  return { ...real, createRendererMap: () => new Map([['maplibre-2d', { mount: () => handle }]]) };
});

const { default: MapScreen } = await import('./MapScreen.svelte');

afterEach(() => {
  cleanup();
  map.taps.length = 0;
  map.clusterTaps.length = 0;
  map.mapTaps.length = 0;
  map.gate = undefined;
  map.centerOn.mockClear();
  map.showOverlay.mockClear();
});

const bar = () => within(screen.getByRole('navigation', { name: 'Kartenleiste' }));

describe('the map screen', () => {
  it('shows the header with the project, the map and the bar in v3 order; Werkzeuge only with an active tool', async () => {
    const { unmount } = render(MapScreen, props());
    expect(await screen.findByText('Bäume')).toBeTruthy(); // the name returns when the map has been idle once
    expect(await screen.findByRole('region', { name: 'Karte' })).toBeTruthy();
    expect(
      bar()
        .getAllByRole('button')
        .map((b) => b.getAttribute('title') ?? b.getAttribute('aria-label')),
    ).toEqual(['Layer', 'Filter', 'Neu', 'Standort', 'Einstellungen']);
    unmount();
    render(MapScreen, props({ device: deviceOf({ search: { source: 'baum.name' } }) }));
    expect(bar().getByRole('button', { name: /Werkzeuge/ })).toBeTruthy();
  });

  it('Werkzeuge is on the bar when the person has a tool on: an offered tool is off until the person switches it on', async () => {
    const toolPrefs = memoryPrefs();
    const device = deviceOf({ search: { sources: ['baum.name'] } }, { search: { availability: 'offered' } });
    render(MapScreen, props({ device, toolPrefs }));
    await screen.findByRole('region', { name: 'Karte' });
    expect(bar().queryByRole('button', { name: /Werkzeuge/ })).toBeNull();
    toolPrefs.set('tools.search', true);
    expect(await bar().findByRole('button', { name: /Werkzeuge/ })).toBeTruthy();
    toolPrefs.set('tools.search', false);
    await waitFor(() => expect(bar().queryByRole('button', { name: /Werkzeuge/ })).toBeNull());
  });

  it('each button opens its sheet through the registry; an unported sheet shows nothing and the button stays', async () => {
    render(MapScreen, props({ registry: registryOf('layers', 'settings') }));
    await fireEvent.click(bar().getByRole('button', { name: /Layer/ }));
    expect(await screen.findByTestId('stub-sheet')).toBeTruthy();
    // the same button closes it, the Filter button (no sheet yet) opens nothing
    await fireEvent.click(bar().getByRole('button', { name: /Layer/ }));
    await waitFor(() => expect(screen.queryByTestId('stub-sheet')).toBeNull());
    await fireEvent.click(bar().getByRole('button', { name: /Filter/ }));
    expect(screen.queryByTestId('stub-sheet')).toBeNull();
    expect(bar().getByRole('button', { name: /Filter/ })).toBeTruthy();
    // Einstellungen is registered; the sheet closes itself through onclose
    await fireEvent.click(bar().getByRole('button', { name: /Einstellungen/ }));
    await fireEvent.click(await screen.findByRole('button', { name: 'close stub' }));
    await waitFor(() => expect(screen.queryByTestId('stub-sheet')).toBeNull());
  });

  it('the + cycles Neu, Neu with Zuletzt beside it, and closed', async () => {
    render(MapScreen, props({ registry: registryOf('create', 'recent') }));
    await fireEvent.click(bar().getByRole('button', { name: 'Neu' }));
    await waitFor(() => expect(screen.getAllByTestId('stub-sheet')).toHaveLength(1));
    await fireEvent.click(bar().getByRole('button', { name: 'Menü schließen' }));
    await waitFor(() => expect(screen.getAllByTestId('stub-sheet')).toHaveLength(2));
    await fireEvent.click(bar().getByRole('button', { name: 'Menü schließen' }));
    await waitFor(() => expect(screen.queryByTestId('stub-sheet')).toBeNull());
  });

  it('the bar hides while a pin is placed and comes back after (v3 isSelectingCoordinates); the sheets learn that Zuletzt is open', async () => {
    render(MapScreen, props({ registry: registryOf('create', 'recent') }));
    await fireEvent.click(bar().getByRole('button', { name: 'Neu' }));
    await fireEvent.click((await screen.findAllByRole('button', { name: 'pin on' }))[0] as HTMLElement);
    expect(screen.queryByRole('navigation', { name: 'Kartenleiste' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'pin off' }));
    expect(screen.getByRole('navigation', { name: 'Kartenleiste' })).toBeTruthy();
    expect(screen.getAllByText('zuletzt closed').length).toBeGreaterThan(0);
    await fireEvent.click(bar().getByRole('button', { name: 'Menü schließen' }));
    await waitFor(() => expect(screen.getAllByText('zuletzt open')).toHaveLength(2));
  });

  it.each([390, 1280])(
    'the + follows the picker, not the form: a form turns it back, + opens the picker over the form, the third press closes picker and Zuletzt and keeps the form (v3 +page.svelte:258-272) (%i px)',
    async (width) => {
      window.innerWidth = width;
      render(MapScreen, props({ registry: registryOf('create', 'recent') }));
      const fab = () => bar().getByRole('button', { name: /Neu|Menü schließen/ });
      await fireEvent.click(fab());
      expect(fab().getAttribute('aria-label')).toBe('Menü schließen'); // step 1
      await fireEvent.click((await screen.findAllByRole('button', { name: 'form on' }))[0] as HTMLElement);
      await waitFor(() => expect(fab().getAttribute('aria-label')).toBe('Neu')); // the picker is closed: the + is back
      expect(screen.getAllByText('picker hidden').length).toBeGreaterThan(0);
      await fireEvent.click(fab()); // the picker over the open form
      await waitFor(() => expect(screen.getAllByText('picker shown').length).toBeGreaterThan(0));
      expect(fab().getAttribute('aria-label')).toBe('Menü schließen');
      await fireEvent.click(fab()); // Zuletzt beside it
      await waitFor(() => expect(screen.getAllByTestId('stub-sheet')).toHaveLength(2));
      await fireEvent.click(fab()); // closed: the picker and Zuletzt, the form stays (the create slot is still open)
      await waitFor(() => expect(screen.getAllByTestId('stub-sheet')).toHaveLength(1));
      expect(screen.getAllByText('picker hidden').length).toBeGreaterThan(0);
      expect(fab().getAttribute('aria-label')).toBe('Neu');
    },
  );

  it('Standort centres the map on the faked position at street level and marks it', async () => {
    const position = { current: () => Promise.resolve({ lon: 7.11, lat: 50.71 }) };
    render(MapScreen, props({ position }));
    await screen.findByRole('region', { name: 'Karte' });
    await waitFor(() => expect(map.taps.length).toBe(1)); // the map is mounted and its handle given out
    await fireEvent.click(bar().getByRole('button', { name: /Standort/ }));
    await waitFor(() => expect(map.centerOn).toHaveBeenCalledWith([7.11, 50.71], { zoom: 15 }));
    expect(map.showOverlay).toHaveBeenCalled();
    expect(screen.queryByText('Standort nicht verfügbar')).toBeNull();
  });

  it('Standort with a denied permission says so (v3 failed silently)', async () => {
    const position = { current: () => Promise.reject(new Error('denied')) };
    render(MapScreen, props({ position }));
    await waitFor(() => expect(map.taps.length).toBe(1));
    await fireEvent.click(bar().getByRole('button', { name: /Standort/ }));
    expect(await screen.findByText('Standort nicht verfügbar')).toBeTruthy();
    expect(map.centerOn).not.toHaveBeenCalled();
  });

  it('a tap on a feature opens the feature slot with its id', async () => {
    render(MapScreen, props({ registry: registryOf('feature') }));
    await waitFor(() => expect(map.taps.length).toBe(1));
    map.taps[0]?.('feature-7');
    expect(await screen.findByText('stub sheet feature-7')).toBeTruthy();
  });

  it('a tap on a cluster opens the cluster slot', async () => {
    render(MapScreen, props({ registry: registryOf('cluster') }));
    await waitFor(() => expect(map.clusterTaps.length).toBeGreaterThan(0));
    expect(screen.queryByText('stub sheet')).toBeNull();
    map.clusterTaps[0]?.({ at: [8, 50], count: 3, members: [] });
    expect(await screen.findByText('stub sheet')).toBeTruthy();
  });

  it('has a skip link that moves focus to the map area (WCAG 2.4.1)', async () => {
    render(MapScreen, props());
    await fireEvent.click(screen.getByRole('link', { name: 'Zum Inhalt springen' }));
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('has no axe violations', async () => {
    const { container } = render(MapScreen, props());
    await screen.findByRole('region', { name: 'Karte' });
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('the map screen: shell parity (WP-645)', () => {
  it('says "Karte wird geladen ..." over the map, and "Objekte werden geladen ..." in the header, until the first idle', async () => {
    let release: () => void = () => undefined;
    map.gate = new Promise<void>((r) => (release = r));
    render(MapScreen, props());
    expect(await screen.findByText('Karte wird geladen ...')).toBeTruthy();
    expect(screen.getByText('Objekte werden geladen ...')).toBeTruthy();
    expect(screen.queryByText('Bäume')).toBeNull();
    release();
    await waitFor(() => expect(screen.queryByText('Karte wird geladen ...')).toBeNull());
    expect(screen.queryByText('Objekte werden geladen ...')).toBeNull();
    expect(screen.getByText('Bäume')).toBeTruthy();
  });

  it('a tap on empty map closes the detail, Neu and Zuletzt (v3 handleMapClick), and leaves a group sheet', async () => {
    render(MapScreen, props({ registry: registryOf('feature', 'create', 'recent', 'layers') }));
    await waitFor(() => expect(map.mapTaps.length).toBeGreaterThan(0));
    await fireEvent.click(bar().getByRole('button', { name: /Layer/ }));
    expect(await screen.findAllByTestId('stub-sheet')).toHaveLength(1);
    map.taps[0]?.('feature-1');
    expect(await screen.findByText('stub sheet feature-1')).toBeTruthy();
    for (const tap of map.mapTaps) tap();
    await waitFor(() => expect(screen.queryByText('stub sheet feature-1')).toBeNull());
    expect(screen.getAllByTestId('stub-sheet')).toHaveLength(1); // Layer is still there
  });

  it('a map tap while a pin is placed keeps the detail open (v3 isEditingLocation, +page.svelte:2388); after placing it closes again', async () => {
    render(MapScreen, props({ registry: registryOf('feature') }));
    await waitFor(() => expect(map.mapTaps.length).toBeGreaterThan(0));
    map.taps[0]?.('feature-1');
    await fireEvent.click((await screen.findAllByRole('button', { name: 'pin on' }))[0] as HTMLElement);
    expect(screen.queryByRole('navigation', { name: 'Kartenleiste' })).toBeNull();
    for (const tap of map.mapTaps) tap();
    expect(screen.getByText('stub sheet feature-1')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'pin off' }));
    for (const tap of map.mapTaps) tap();
    await waitFor(() => expect(screen.queryByText('stub sheet feature-1')).toBeNull());
  });

  it('opening Layer keeps an open feature detail (v3: the layer flag is not the selection)', async () => {
    render(MapScreen, props({ registry: registryOf('feature', 'layers') }));
    await waitFor(() => expect(map.taps.length).toBe(1));
    map.taps[0]?.('feature-2');
    expect(await screen.findByText('stub sheet feature-2')).toBeTruthy();
    await fireEvent.click(bar().getByRole('button', { name: /Layer/ }));
    await waitFor(() => expect(screen.getAllByTestId('stub-sheet')).toHaveLength(2));
    expect(screen.getByText('stub sheet feature-2')).toBeTruthy();
  });

  it('the + of the header cycles like the bar: Neu, Neu with Zuletzt, closed (v3 onWorkflowClick)', async () => {
    render(MapScreen, props({ registry: registryOf('create', 'recent') }));
    const header = within(screen.getByRole('banner'));
    await fireEvent.click(header.getByRole('button', { name: 'Neu' }));
    await waitFor(() => expect(screen.getAllByTestId('stub-sheet')).toHaveLength(1));
    await fireEvent.click(header.getByRole('button', { name: 'Neu' }));
    await waitFor(() => expect(screen.getAllByTestId('stub-sheet')).toHaveLength(2));
    await fireEvent.click(header.getByRole('button', { name: 'Neu' }));
    await waitFor(() => expect(screen.queryByTestId('stub-sheet')).toBeNull());
  });

  it('a tool badge reaches the bar and the header icon, and is cleared while the Werkzeuge sheet is open', async () => {
    const device = deviceOf({ search: { source: 'baum.name' } }, undefined, {
      search: { hard: 120, soft: false },
    });
    render(MapScreen, props({ device, registry: registryOf('tools') }));
    expect(await within(screen.getByRole('banner')).findByText('99+')).toBeTruthy();
    expect(bar().getByText('99+')).toBeTruthy();
    await fireEvent.click(bar().getByRole('button', { name: /Werkzeuge/ }));
    await waitFor(() => expect(screen.queryByText('99+')).toBeNull());
  });
  it('"Im Chat erwähnen" opens the chat panel itself, once, and a second request keeps it open', async () => {
    const device = deviceOf({ chat: {} });
    render(MapScreen, props({ device, registry: registryOf('tools', 'chat') }));
    expect(screen.queryByTestId('stub-sheet')).toBeNull();
    device.chat.mention('f1');
    await waitFor(() => expect(screen.getAllByTestId('stub-sheet')).toHaveLength(1));
    device.chat.mention('f2'); // the chat is open already: no toggle that would close it
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getAllByTestId('stub-sheet')).toHaveLength(1);
  });

  it('the chat stays open under Layer, Filter, Werkzeuge and Einstellungen, as in v3 (`chatSheetOpen` is its own flag, `+page.svelte:2516-2540`); the + closes it (`:266`)', async () => {
    const device = deviceOf({ chat: {} });
    render(MapScreen, props({ device, registry: registryOf('layers', 'settings', 'chat') }));
    device.chat.mention('f1');
    await waitFor(() => expect(screen.getAllByTestId('stub-sheet')).toHaveLength(1));
    await fireEvent.click(bar().getByRole('button', { name: /Layer/ }));
    await waitFor(() => expect(screen.getAllByTestId('stub-sheet')).toHaveLength(2));
    await fireEvent.click(bar().getByRole('button', { name: /Einstellungen/ }));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getAllByTestId('stub-sheet')).toHaveLength(2); // Einstellungen replaced Layer; the chat stands
    await fireEvent.click(bar().getByRole('button', { name: /Einstellungen/ }));
    await waitFor(() => expect(screen.getAllByTestId('stub-sheet')).toHaveLength(1));
    await fireEvent.click(bar().getByRole('button', { name: 'Neu' }));
    await waitFor(() => expect(screen.queryByTestId('stub-sheet')).toBeNull()); // no 'create' stub, and the chat is gone
  });

  it('a badge that changes after the screen opened reaches the bar (an unread message arrives)', async () => {
    let badges: Record<string, { hard: number; soft: boolean }> = {};
    const fns = new Set<() => void>();
    const device = deviceOf({ search: { source: 'baum.name' } });
    (device as unknown as { toolBadges: unknown }).toolBadges = {
      current: () => badges,
      subscribe: (fn: () => void) => (fns.add(fn), () => fns.delete(fn)),
    };
    render(MapScreen, props({ device }));
    expect(bar().queryByText('3')).toBeNull();
    badges = { search: { hard: 3, soft: true } };
    fns.forEach((f) => f());
    expect(await bar().findByText('3')).toBeTruthy();
  });
});
