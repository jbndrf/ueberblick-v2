// @vitest-environment jsdom
// The Offline-Pakete table asks the build endpoint only while a pack is queued or building (R14: no idle polling).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import type * as Sonner from 'svelte-sonner';
import type { PackStatus } from '@ueberblick/server';
import { rowOf, setViewport, shimLayout } from '../participants/page.testkit';
import SettingsPage from './SettingsPage.svelte';
import { POLL_MS } from './pack-status';
import type { SettingsApi } from './api';
import type { SettingsPageData } from './types';

vi.mock('svelte-sonner', async (original) => ({
  ...(await original<typeof Sonner>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('./RegionSelector.svelte', async () => ({
  default: (await import('./RegionSelector.testing.svelte')).default,
}));

shimLayout();
beforeEach(() => setViewport(1280));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const PACK_ROW = {
  key: 'innen',
  name: 'Innenstadt',
  bounds: [7.08, 50.7, 7.14, 50.75] as const,
  minZoom: 12,
  maxZoom: 14,
  layers: ['osm'],
  roles: [],
};
const BASE = {
  projectName: 'Musterstadt',
  branding: { name: '', icon: null },
  map: { lat: 50.7, lng: 7.1, zoom: 10, minZoom: 1, maxZoom: 19, saved: true },
  layers: { layers: [], roles: [] },
  infoPages: [],
  packs: [PACK_ROW],
  packLayers: [{ key: 'osm', label: 'Straßenkarte', base: true, packable: true }],
  roles: [],
  mapConfig: null,
  template: { key: 't', label: 'T', version: '1.0.0', inputs: [] },
  chat: { enabled: false, all: false, roles: [], options: [] },
  startup: { layers: [], types: [] },
  cluster: { declared: false, roles: [] },
  fieldFilters: { declared: false, roles: [] },
  lifecycle: { version: 3, neverPublished: false, dirty: false, types: [], other: [], blockerCount: 0 },
} as SettingsPageData;

const status = (state: PackStatus['state']): PackStatus =>
  ({
    key: 'innen',
    label: 'Innenstadt',
    bounds: [7.08, 50.7, 7.14, 50.75],
    min_zoom: 12,
    max_zoom: 14,
    roles: [],
    hash: 'h',
    estimate: { tiles: 120, bytes: 1 },
    state,
    progress: { tiles_done: 60, tiles_total: 120, bytes: 1 },
    bytes: 2048,
    built_at: null,
    error: state === 'failed' ? 'tile host down' : null,
    layers: [
      {
        layer: 'osm',
        state,
        progress: { tiles_done: 0, tiles_total: 0, bytes: 0 },
        max_zoom: 14,
        tiles: 99,
        sha256: null,
        error: null,
        estimate: { tiles: 120, bytes: 1, max_zoom: 14 },
      },
    ],
  }) as PackStatus;

const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
const mountWith = (packStatuses: ReturnType<typeof vi.fn>, rebuildPack = vi.fn(() => ok({}))) => {
  const api = { packStatuses, rebuildPack } as unknown as SettingsApi;
  render(SettingsPage, {
    data: BASE,
    locale: 'de',
    project: 'musterstadt',
    api,
    reload: vi.fn(() => Promise.resolve()),
    current: 'offline-packs',
    onselect: vi.fn(),
  });
};
const tick = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe('Offline-Pakete polling', () => {
  it('makes no further request while nothing is building', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const packStatuses = vi.fn(() => ok([status('ready')]));
    mountWith(packStatuses);
    await waitFor(() => expect(packStatuses).toHaveBeenCalledTimes(1));
    await tick(POLL_MS * 5);
    expect(packStatuses).toHaveBeenCalledTimes(1);
  });

  it('keeps asking while a pack builds and stops once it is ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const answers = [status('building'), status('building'), status('ready')];
    const packStatuses = vi.fn(() => ok([answers.shift() ?? status('ready')]));
    mountWith(packStatuses);
    await waitFor(() => expect(packStatuses).toHaveBeenCalledTimes(1));
    await tick(POLL_MS + 50);
    await tick(POLL_MS + 50);
    await waitFor(() => expect(packStatuses.mock.calls.length).toBeGreaterThanOrEqual(3));
    const calls = packStatuses.mock.calls.length;
    await tick(POLL_MS * 5);
    expect(packStatuses).toHaveBeenCalledTimes(calls);
  });

  it('polling restarts after "Neu bauen"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let state: PackStatus['state'] = 'failed';
    const packStatuses = vi.fn(() => ok([status(state)]));
    const rebuildPack = vi.fn(() => {
      state = 'queued';
      return ok({});
    });
    mountWith(packStatuses, rebuildPack);
    await waitFor(() => expect(within(rowOf('innen')).getByText('tile host down')).toBeTruthy());
    const idle = packStatuses.mock.calls.length;
    await tick(POLL_MS * 3);
    expect(packStatuses).toHaveBeenCalledTimes(idle);
    await fireEvent.click(within(rowOf('innen')).getByRole('button', { name: 'Neu bauen' }));
    await waitFor(() => expect(rebuildPack).toHaveBeenCalledWith('innen'));
    await waitFor(() => expect(screen.getByTestId('pack-status').dataset['state']).toBe('queued'));
    const after = packStatuses.mock.calls.length;
    await tick(POLL_MS + 50);
    expect(packStatuses.mock.calls.length).toBeGreaterThan(after);
  });
});
