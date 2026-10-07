// WP-667: Offline-Bilder. With the switch on, thumbnails of the photos in scope are on the device; with it off none
// are, and the switch is the person's preference (so it follows the person to another device).
import { describe, expect, it } from 'vitest';
import type { ThumbTransport } from '@ueberblick/client';
import type { Json } from '@ueberblick/core/model';
import { memoryThumbCache } from '../../../../../../packages/client/src/blobs/memory';
import { createOfflineImages, type ImagesPrefs, type OfflineImagesDeps } from './images';
import { scanPhotos } from './photos';

const sha = (n: number): string => n.toString(16).padStart(64, '0');

function setup(over: Partial<OfflineImagesDeps> & { photos?: string[]; enabled?: boolean } = {}) {
  let enabled = over.enabled ?? false;
  const listeners = new Set<() => void>();
  const writes: boolean[] = [];
  const prefs: ImagesPrefs = {
    enabled: () => enabled,
    set: (on) => {
      writes.push(on);
      enabled = on;
      listeners.forEach((l) => l());
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
  const cache = over.cache ?? memoryThumbCache();
  const asked: string[] = [];
  const transport: ThumbTransport = over.transport ?? {
    fetch: async (s) => {
      asked.push(s);
      return { bytes: new Uint8Array(50), mime: 'image/webp' };
    },
  };
  let online = true;
  const photos = over.photos ?? [sha(1), sha(2), sha(3)];
  const images = createOfflineImages({
    cache,
    transport,
    prefs,
    photosInScope: over.photosInScope ?? (async () => photos),
    online: over.online ?? (() => online),
  });
  return {
    images,
    cache,
    asked,
    writes,
    prefs,
    setOnline: (v: boolean) => (online = v),
    other: (on: boolean) => {
      // another device changed the record: the prefs client merged it
      enabled = on;
      listeners.forEach((l) => l());
    },
  };
}

describe('Offline-Bilder switch', () => {
  it('on: the preference is written and a thumbnail of every photo in scope is on the device', async () => {
    const { images, cache, writes } = setup();
    await images.setEnabled(true);
    expect(writes).toEqual([true]);
    expect(await cache.count()).toBe(3);
    expect(await images.files()).toBe(3);
    expect(images.state()).toMatchObject({ enabled: true, phase: 'idle' });
  });

  it('progress is told while it downloads: phase downloading, done out of total', async () => {
    const { images } = setup();
    const seen: string[] = [];
    images.subscribe((s) => seen.push(`${s.phase}:${String(s.done)}/${String(s.total)}`));
    await images.setEnabled(true);
    expect(seen).toContain('downloading:0/0');
    expect(seen).toContain('downloading:0/3');
    expect(seen).toContain('downloading:3/3');
    expect(seen.at(-1)).toMatch(/^idle/);
  });

  it('off: everything cached is removed and the preference is off', async () => {
    const { images, cache, writes } = setup();
    await images.setEnabled(true);
    await images.setEnabled(false);
    expect(writes).toEqual([true, false]);
    expect(await cache.count()).toBe(0);
    expect(images.state().enabled).toBe(false);
  });

  it('off from the start stores nothing, even when photos are in scope and the device is online', async () => {
    const { images, cache, asked } = setup();
    await images.start();
    await images.refresh();
    expect(await cache.count()).toBe(0);
    expect(asked).toEqual([]);
  });

  it('a person with the preference on starts a new device: the thumbnails come at the start, online', async () => {
    const { images, cache } = setup({ enabled: true });
    await images.start();
    expect(await cache.count()).toBe(3);
  });

  it('offline: no fetch is made for display; the download waits for the connection and refresh fills it', async () => {
    const { images, cache, asked, setOnline } = setup({ enabled: true });
    setOnline(false);
    await images.start();
    expect(asked).toEqual([]);
    expect(await cache.count()).toBe(0);
    setOnline(true);
    await images.refresh();
    expect(await cache.count()).toBe(3);
  });

  it('a refresh asks only for the photos that arrived since', async () => {
    let photos = [sha(1)];
    const { images, asked } = setup({ enabled: true, photosInScope: async () => photos });
    await images.start();
    photos = [sha(1), sha(2)];
    await images.refresh();
    expect(asked).toEqual([sha(1), sha(2)]);
  });

  it('the preference changed on another device is followed: on downloads, off removes', async () => {
    const { images, cache, other } = setup();
    await images.start();
    other(true);
    await images.idle();
    expect(await cache.count()).toBe(3);
    other(false);
    await images.idle();
    expect(await cache.count()).toBe(0);
  });

  it('turning it off while it downloads stops the download and leaves nothing', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { images, cache } = setup({
      transport: {
        fetch: async () => {
          await gate;
          return { bytes: new Uint8Array(10), mime: 'image/webp' };
        },
      },
    });
    const on = images.setEnabled(true);
    await images.setEnabled(false);
    release();
    await on;
    expect(await cache.count()).toBe(0);
  });

  it('a device without IndexedDB is not supported: the switch is not offered', () => {
    const { images } = setup({ cache: memoryThumbCache(false) });
    expect(images.supported).toBe(false);
  });
});

describe('scanPhotos', () => {
  const feature = (props: Record<string, Json>) => ({ properties: props });
  const file = (n: number, mime = 'image/jpeg') => ({ sha256: sha(n), name: `${String(n)}.jpg`, mime });

  it('finds the images in every file property, once each, and leaves other files out', async () => {
    const features = [
      feature({ foto: [file(1), file(2)], name: 'x' }),
      feature({ foto: [file(2)], plan: [file(9, 'application/pdf')] }),
      feature({ foto: null }),
    ];
    const out = await scanPhotos({ features, yieldNow: async () => undefined });
    expect(out.slice().sort()).toEqual([sha(1), sha(2)]);
  });

  it('gives the main thread back between slices of features', async () => {
    let yields = 0;
    const features = Array.from({ length: 1050 }, () => feature({}));
    await scanPhotos({
      features,
      slice: 500,
      yieldNow: async () => void (yields += 1),
    });
    expect(yields).toBe(2);
  });
});

describe('Offline-Bilder prune (WP-770)', () => {
  it('drops the thumbnails of photos that left the scope on the next refresh, and keeps the rest', async () => {
    let photos = [sha(1), sha(2), sha(3)];
    const t = setup({ enabled: true, photosInScope: async () => photos });
    await t.images.start();
    expect([...(await t.cache.keys())].sort()).toEqual([sha(1), sha(2), sha(3)]);
    photos = [sha(1), sha(3)]; // sha(2) was erased or its feature left the scope
    await t.images.refresh();
    expect([...(await t.cache.keys())].sort()).toEqual([sha(1), sha(3)]);
    expect(t.asked.filter((s) => s === sha(1))).toHaveLength(1); // nothing was fetched twice
  });

  it('prunes while offline too (no network is needed)', async () => {
    let photos = [sha(1), sha(2)];
    const t = setup({ enabled: true, photosInScope: async () => photos });
    await t.images.start();
    t.setOnline(false);
    photos = [sha(1)];
    await t.images.refresh();
    expect(await t.cache.keys()).toEqual([sha(1)]);
  });

  it('a scope that empties clears every thumbnail', async () => {
    let photos = [sha(1), sha(2)];
    const t = setup({ enabled: true, photosInScope: async () => photos });
    await t.images.start();
    photos = [];
    await t.images.refresh();
    expect(await t.cache.count()).toBe(0);
  });
});
