// An OfflineContext over a memory store and a fake server, for the specs of the tab, the card and the shell. Tests only.
import {
  bytesOf,
  fakePack,
  fakeServer,
  type FakeServer,
} from '../../../../../../packages/client/src/packs/fake-server.testing';
import {
  memoryPackStorage,
  type MemoryPackStorage,
} from '../../../../../../packages/client/src/packs/storage-memory';
import { memoryThumbCache } from '../../../../../../packages/client/src/blobs/memory';
import type { OfflineContext, StorageNumbers } from './context';
import { createOfflineImages } from './images';
import { createOffline } from './model';
import { createPwa, type PwaEnv } from './pwa';

export interface FakeOffline {
  readonly context: OfflineContext;
  readonly server: FakeServer;
  readonly storage: MemoryPackStorage;
  /** The thumbnails kept on the device, and the photos in scope the fake server has a thumbnail for. */
  readonly thumbs: ReturnType<typeof memoryThumbCache>;
  /** The person's preference, as the record would hold it. */
  readonly pref: { on: boolean };
  /** The photos in scope; change it to model an erasure or a lost role. */
  readonly scope: { photos: string[] };
  /** Every thumbnail the fake server was asked for. */
  readonly thumbsAsked: string[];
  /** Holds the thumbnail downloads until `release()`; `online` is what the device reports. */
  readonly net: { hold(): void; release(): void; online: boolean };
  /** Fires a platform event the install state listens to. */
  readonly fire: (type: string, event?: unknown) => void;
}

export const PACK_LAYER_BYTES = bytesOf(2048, 1);

export function fakeOffline(
  over: {
    supported?: boolean;
    storage?: Partial<StorageNumbers>;
    standalone?: boolean;
    /** An iPhone/iPad Safari (no install prompt). */
    ios?: boolean;
    /** The packs the server offers; default one pack "Innenstadt". */
    packs?: { key: string; label: string; layer: string }[];
    /** The sha256 of the photos the device holds features for; default none. */
    photos?: string[];
    /** Starts with the preference on (a person who switched it on elsewhere). */
    imagesOn?: boolean;
    /** Without IndexedDB. */
    noThumbCache?: boolean;
  } = {},
): FakeOffline {
  const packs = over.packs ?? [{ key: 'innen', label: 'Innenstadt', layer: 'osm' }];
  const contents: Record<string, Uint8Array> = {};
  const entries = packs.map((p) => {
    const e = fakePack(p.key, `h-${p.key}`, [{ layer: p.layer, bytes: PACK_LAYER_BYTES, tiles: 1200 }]);
    for (const l of e.layers) contents[l.url] = PACK_LAYER_BYTES;
    return { ...e, label: p.label };
  });
  const server = fakeServer(entries, contents);
  const storage = memoryPackStorage({ supported: over.supported ?? true });
  const listeners = new Map<string, (e: unknown) => void>();
  const env: PwaEnv = {
    standalone: () => over.standalone ?? false,
    ios: () => over.ios ?? false,
    on: (type, fn) => {
      listeners.set(type, fn);
      return () => void listeners.delete(type);
    },
    serviceWorker: { getRegistration: async () => ({}), ready: Promise.resolve({}) },
  };
  const thumbs = memoryThumbCache(!over.noThumbCache);
  const pref = { on: over.imagesOn ?? false };
  const scope = { photos: over.photos ?? [] };
  const prefListeners = new Set<() => void>();
  const thumbsAsked: string[] = [];
  let gate: Promise<void> | undefined;
  let release: () => void = () => undefined;
  const net = {
    hold: () => void (gate = new Promise<void>((r) => (release = r))),
    release: () => release(),
    online: true,
  };
  const images = createOfflineImages({
    cache: thumbs,
    transport: {
      fetch: async (sha) => {
        await gate;
        thumbsAsked.push(sha);
        return { bytes: new Uint8Array(2048), mime: 'image/webp' };
      },
    },
    prefs: {
      enabled: () => pref.on,
      set: (on) => {
        pref.on = on;
        prefListeners.forEach((l) => l());
      },
      subscribe: (fn) => {
        prefListeners.add(fn);
        return () => void prefListeners.delete(fn);
      },
    },
    photosInScope: async () => scope.photos,
    online: () => net.online,
  });
  return {
    context: {
      offline: createOffline({ storage, transport: server }),
      pwa: createPwa(env),
      images,
      storage: {
        persisted: async () => true,
        estimate: async () => ({ usage: 512 * 1024 * 1024, quota: 2 * 1024 ** 3 }),
        ...over.storage,
      },
    },
    server,
    storage,
    thumbs,
    pref,
    scope,
    thumbsAsked,
    net,
    fire: (type, event = {}) => listeners.get(type)?.(event),
  };
}
