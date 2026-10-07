// @vitest-environment jsdom
// WP-650: the map screen wires the offline packs (WP-662 Notes): the pack index is read before the map mounts, the
// renderer gets the pack protocol, the download card sits above the bar, and the install listener ends with the screen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@ueberblick/ui';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { createPrefsClient } from '@ueberblick/client';
import type { Device } from '../device';
import { fakeOffline } from '../offline/fake.testing';

vi.mock('maplibre-gl', () => ({ setWorkerUrl: () => undefined }));
const seen = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock('@ueberblick/ui', async (importOriginal) => {
  const real = await importOriginal<typeof Ui>();
  const handle = {
    ready: Promise.resolve(),
    onFeatureTap: () => () => undefined,
    onMapTap: () => () => undefined,
    onExtentChange: () => () => undefined,
    extent: () => [7, 50, 8, 51],
    centerOn: () => undefined,
    showOverlay: () => undefined,
    destroy: () => undefined,
  };
  return {
    ...real,
    createRendererMap: (_extra: unknown, options: unknown) => {
      seen.options.push(options);
      return new Map([['maplibre-2d', { mount: () => handle }]]);
    },
  };
});
const { default: MapScreen } = await import('./MapScreen.svelte');

const quiet = () => () => undefined;
const syncListeners: ((s: unknown) => void)[] = [];
const device = {
  project: 'baeume',
  participant: { id: 'berta' },
  clock: { now: () => new Date().toISOString() },
  identity: { project: { key: 'baeume', displayName: 'Bäume', icon: null, preview: false } },
  roleKey: 'kontrolle',
  actor: { id: 'u1', kind: 'participant', roles: ['kontrolle'] },
  get classified() {
    return (this as { config: never }).config;
  },
  config: {
    file: {
      types: { baum: { properties: {} } },
      views: {
        karte: {
          source: { type: 'baum' },
          layers: { l: { renderer: 'maplibre-2d', style: { layers: [] } } },
        },
      },
      tools: {},
    },
  },
  queue: { status: () => ({ pending: 0, refused: [], review: [] }), subscribe: quiet },
  sync: {
    worker: {
      status: () => ({ phase: 'idle', featuresLoaded: 0 }),
      subscribe: (fn: (s: unknown) => void) => {
        syncListeners.push(fn);
        return () => undefined;
      },
    },
  },
  problems: { list: () => [], subscribe: quiet, report: () => undefined },
  toolBadges: { current: () => ({}), subscribe: quiet },
  network: { current: () => true, subscribe: quiet },
  chat: { onOpenRequest: quiet },
  reader: { startableTasks: () => [] },
  viewSource: () => ({ query: () => [], subscribe: quiet }),
  viewList: () => ({ rows: () => [], rowsOf: () => [], rename: (rows: readonly unknown[]) => rows }),
  changed: { subscribe: quiet },
} as unknown as Device;

const prefs = () => {
  const store = new Map<string, string>();
  return createPrefsClient({
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
    project: 'baeume',
    participant: 'berta',
  });
};

afterEach(() => {
  cleanup();
  syncListeners.length = 0;
  seen.options.length = 0;
});

const mount = (fake: ReturnType<typeof fakeOffline>) =>
  render(MapScreen, {
    device,
    toolPrefs: prefs(),
    locale: 'de' as const,
    onsignout: async () => true,
    onlocale: () => undefined,
    registry: () => undefined,
    offlineContext: fake.context,
  });

describe('the map screen and the offline packs', () => {
  it('mounts the map after the pack index is read, with the pack protocol for the renderer', async () => {
    const fake = fakeOffline();
    await fake.context.offline.manager.sync(); // a pack is on the device
    mount(fake);
    expect(await screen.findByRole('region', { name: 'Karte' })).toBeTruthy();
    expect(seen.options.at(-1)).toEqual({
      packProtocol: fake.context.offline.packProtocol,
      proxy: { project: device.project, origin: location.origin }, // tiles via the project's proxy (A-033)
    });
    expect(fake.context.offline.packProtocol.has('osm')).toBe(true); // routed from the first frame
  });

  it('a device without OPFS mounts the map at once', () => {
    mount(fakeOffline({ supported: false }));
    expect(screen.getByTestId('map')).toBeTruthy();
  });

  it('the download card appears above the bar while a pack downloads, with no sheet open', async () => {
    const fake = fakeOffline();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const real = fake.server.download.bind(fake.server);
    fake.server.download = async (u, f, s) => {
      await gate;
      return real(u, f, s);
    };
    mount(fake);
    await fake.context.offline.list();
    const run = fake.context.offline.manager.download(['innen']);
    expect(await screen.findByTestId('download-card')).toBeTruthy();
    release();
    await run;
    await waitFor(() => expect(screen.queryByTestId('download-card')).toBeNull());
  });

  it('stops listening for the install prompt when the screen goes', () => {
    const fake = fakeOffline();
    const stop = vi.spyOn(fake.context.pwa, 'stop');
    const { unmount } = mount(fake);
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it('a delta that applied data (an erasure) refreshes the offline images and drops the erased thumbnail (WP-770)', async () => {
    const sha = (n: number) => String(n).repeat(64);
    const fake = fakeOffline({ imagesOn: true, photos: [sha(1), sha(2)] });
    mount(fake);
    await waitFor(() => expect(syncListeners.length).toBeGreaterThan(0));
    await waitFor(async () => expect((await fake.thumbs.keys()).length).toBe(2));
    // the redaction arrived in a delta: featuresLoaded stays 0, only the cursor moves
    fake.scope.photos = [sha(1)];
    for (const fn of syncListeners) fn({ phase: 'idle', featuresLoaded: 0, lastSyncedSeq: 7 });
    await waitFor(async () => expect([...(await fake.thumbs.keys())]).toEqual([sha(1)]));
  });

  it('a status that changed nothing the sync applied does not refresh', async () => {
    const fake = fakeOffline({ imagesOn: true, photos: [] });
    mount(fake);
    await waitFor(() => expect(syncListeners.length).toBeGreaterThan(0));
    const refresh = vi.spyOn(fake.context.images, 'refresh');
    for (const fn of syncListeners) fn({ phase: 'delta', featuresLoaded: 0, lastSyncedSeq: 8 });
    for (const fn of syncListeners) fn({ phase: 'idle', featuresLoaded: 0, lastSyncedSeq: undefined });
    expect(refresh).not.toHaveBeenCalled();
  });
});
