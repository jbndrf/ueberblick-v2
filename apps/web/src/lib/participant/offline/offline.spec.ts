// WP-650: the headless parts of the Offline tab: sizes and dates, the install state, the storage numbers, the
// download card's state and the model that binds the pack manager and the map protocol.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bytesOf,
  fakePack,
  fakeServer,
} from '../../../../../../packages/client/src/packs/fake-server.testing';
import { memoryPackStorage } from '../../../../../../packages/client/src/packs/storage-memory';
import type { PackProgress } from '@ueberblick/client';
import { formatBytes, formatDay } from './format';
import { createOffline } from './model';
import { downloadingNow } from './progress';
import { createPwa, isIos, type PwaEnv } from './pwa';
import { onReadyPacksChange } from './watch';
import { storageStats } from './stats';

describe('formatBytes', () => {
  it('uses B, KB, MB as v3 and GB for the quota', () => {
    expect(formatBytes(0, 'en')).toBe('0 B');
    expect(formatBytes(1023, 'en')).toBe('1023 B');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024, 'en')).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 ** 3, 'en')).toBe('3.0 GB');
  });
  it('writes the decimal sign of the app language (WP-713)', () => {
    expect(formatBytes(1536, 'de')).toBe('1,5 KB');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
  });
  it('never throws and always ends in a unit', () => {
    fc.assert(
      fc.property(fc.nat({ max: 2 ** 50 }), (n) => /^[\d,.]+ (B|KB|MB|GB)$/.test(formatBytes(n, 'en'))),
    );
  });
  it('formats a build date in the language', () => {
    expect(formatDay('2026-10-01T10:00:00Z', 'de')).toContain('2026');
    expect(formatDay('nonsense', 'de')).toBe('');
  });
});

function pwaEnv(over: Partial<PwaEnv> = {}) {
  const listeners = new Map<string, (e: unknown) => void>();
  const env: PwaEnv = {
    standalone: () => false,
    ios: () => false,
    on: (type, fn) => {
      listeners.set(type, fn);
      return () => listeners.delete(type);
    },
    serviceWorker: {
      getRegistration: async () => ({}),
      ready: Promise.resolve({}),
    },
    ...over,
  };
  return { env, fire: (t: string, e: unknown = {}) => listeners.get(t)?.(e), listeners };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createPwa (v3 pwa-detection.svelte.ts)', () => {
  it('reports the browser, a registered service worker and no install prompt at first', async () => {
    const { env } = pwaEnv();
    const pwa = createPwa(env);
    await tick();
    expect(pwa.get()).toMatchObject({ mode: 'browser', canInstall: false, swStatus: 'registered' });
  });

  it('keeps the install prompt the browser fires, shows it on install and clears it after', async () => {
    const { env, fire } = pwaEnv();
    const pwa = createPwa(env);
    let prompted = 0;
    const event = {
      preventDefault: () => undefined,
      prompt: async () => void (prompted += 1),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    };
    fire('beforeinstallprompt', event);
    expect(pwa.get().canInstall).toBe(true);
    expect(await pwa.install()).toBe(true);
    expect(prompted).toBe(1);
    expect(pwa.get()).toMatchObject({ canInstall: false, mode: 'pwa' });
    expect(await pwa.install()).toBe(false); // the prompt works once
  });

  it('a dismissed prompt stays a browser', async () => {
    const { env, fire } = pwaEnv();
    const pwa = createPwa(env);
    fire('beforeinstallprompt', {
      preventDefault: () => undefined,
      prompt: async () => undefined,
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    });
    expect(await pwa.install()).toBe(false);
    expect(pwa.get().mode).toBe('browser');
  });

  it('an installed app is a pwa from the start, and appinstalled flips a browser into one', () => {
    expect(createPwa(pwaEnv({ standalone: () => true }).env).get().mode).toBe('pwa');
    const { env, fire } = pwaEnv();
    const pwa = createPwa(env);
    fire('appinstalled');
    expect(pwa.get()).toMatchObject({ mode: 'pwa', canInstall: false });
  });

  it('says unsupported without service workers and shows the error of a failing registration', async () => {
    expect(createPwa(pwaEnv({ serviceWorker: undefined }).env).get().swStatus).toBe('unsupported');
    const pwa = createPwa(
      pwaEnv({
        serviceWorker: {
          getRegistration: async () => Promise.reject(new Error('SecurityError')),
          ready: new Promise(() => undefined),
        },
      }).env,
    );
    await tick();
    expect(pwa.get()).toMatchObject({ swStatus: 'error', swError: 'SecurityError' });
  });

  it('notifies subscribers and stops listening on stop', async () => {
    const { env, listeners } = pwaEnv();
    const pwa = createPwa(env);
    const seen: string[] = [];
    const off = pwa.subscribe((s) => seen.push(s.swStatus));
    await tick();
    expect(seen[0]).toBe('checking');
    expect(seen.at(-1)).toBe('registered');
    off();
    pwa.stop();
    expect(listeners.size).toBe(0);
  });
});

describe('storageStats (v3 SettingsSheet.svelte:817-870)', () => {
  const counts = { packs: [], totals: { packs: 1, bytes: 10, tiles: 1200 } };
  it('computes usage, share and the v3 colour steps (orange above 70 %, red above 90 %)', () => {
    const at = (usage: number) =>
      storageStats({ estimate: { usage, quota: 100 }, persisted: true, counts, records: 7 });
    expect(at(10)).toMatchObject({ percent: 10, level: 'ok', persistent: true, tiles: 1200, records: 7 });
    expect(at(71).level).toBe('warn');
    expect(at(91).level).toBe('high');
    expect(at(70).level).toBe('ok');
  });
  it('has no bar when the browser does not tell the quota, and clamps the share', () => {
    expect(storageStats({ estimate: undefined, persisted: false, counts, records: 0 })).toMatchObject({
      quota: 0,
      percent: 0,
      persistent: false,
    });
    fc.assert(
      fc.property(fc.nat(), fc.integer({ min: 1, max: 1e9 }), (usage, quota) => {
        const s = storageStats({ estimate: { usage, quota }, persisted: false, counts, records: 0 });
        expect(s.percent).toBeGreaterThanOrEqual(0);
        expect(s.percent).toBeLessThanOrEqual(100);
      }),
    );
  });
});

describe('downloadingNow (the download card above the bar)', () => {
  const p = (state: PackProgress['state'], done = 0, total = 100): PackProgress => ({
    state,
    bytes_done: done,
    bytes_total: total,
  });
  it('is nothing while no pack downloads, and names the running one', () => {
    expect(downloadingNow({ a: p('ready'), b: p('absent'), c: p('failed') }, () => 'x')).toBeUndefined();
    const now = downloadingNow({ a: p('ready'), b: p('downloading', 40, 100) }, (k) => `Pack ${k}`);
    expect(now).toEqual({ key: 'b', label: 'Pack b', done: 40, total: 100, queued: 0 });
  });
  it('counts queued packs behind the running one', () => {
    const now = downloadingNow({ a: p('downloading', 1, 2), b: p('queued'), c: p('queued') }, (k) => k);
    expect(now?.queued).toBe(2);
  });
});

describe('createOffline: the manager, the map protocol and what the tab binds', () => {
  const A = bytesOf(500, 1);
  const url = '/api/p/demo/packs/h1/osm.pmtiles';
  function setup(supported = true) {
    const storage = memoryPackStorage({ supported });
    const server = fakeServer([fakePack('innen', 'h1', [{ layer: 'osm', bytes: A }])], { [url]: A });
    const offline = createOffline({ storage, transport: server });
    return { storage, server, offline };
  }

  it('routes a layer through the pack protocol once a pack holds it, and not before', async () => {
    const { offline } = setup();
    await offline.ready;
    expect(offline.packProtocol.has('osm')).toBe(false);
    await offline.manager.sync();
    expect(offline.packProtocol.has('osm')).toBe(true);
    expect(offline.packProtocol.has('flur')).toBe(false);
  });

  it('a restart finds the packs on the device before any request (offline start)', async () => {
    const { storage, server } = setup();
    await createOffline({ storage, transport: server }).manager.sync();
    server.offline = true;
    const again = createOffline({ storage, transport: server });
    expect(again.packProtocol.has('osm')).toBe(false); // until loaded: the map waits for `ready`
    await again.ready;
    expect(again.packProtocol.has('osm')).toBe(true);
    expect((await again.manager.counts()).totals.packs).toBe(1);
  });

  it('a device without OPFS is not supported and holds no pack', async () => {
    const { offline } = setup(false);
    await offline.ready;
    expect(offline.supported).toBe(false);
    expect(offline.packProtocol.has('osm')).toBe(false);
  });

  it('listing names the packs of the server, or the reason it could not', async () => {
    const { offline, server } = setup();
    const ok = await offline.list();
    expect(ok.ok && ok.packs.map((p) => p.key)).toEqual(['innen']);
    server.offline = true;
    expect(await offline.list()).toEqual({ ok: false, reason: 'offline' });
  });
});

describe('the offline catalogue', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const cat = (l: string): Record<string, string> =>
    JSON.parse(readFileSync(join(here, '..', '..', '..', '..', 'messages', `${l}.json`), 'utf8')) as Record<
      string,
      string
    >;
  const de = cat('de');
  const en = cat('en');
  const keys = Object.keys(de).filter((k) => k.startsWith('participant_offline_'));
  const SAME = new Set(['participant_offline_service_worker', 'participant_offline_packages_zoom']);

  it('has a real English translation for every string (bug B2: v3 left German in the English file)', () => {
    expect(keys.length).toBeGreaterThan(40);
    for (const k of keys) {
      expect(en[k], k).toBeTruthy();
      if (!SAME.has(k)) expect(en[k], k).not.toBe(de[k]);
    }
  });

  it('the components hold no literal UI text', () => {
    const dirs = [here, join(here, '..', 'sheets', 'settings', 'offline')];
    for (const d of dirs)
      for (const f of readdirSync(d).filter((n) => n.endsWith('.svelte'))) {
        const src = readFileSync(join(d, f), 'utf8');
        const markup = src.slice(src.lastIndexOf('</script>'));
        expect(markup.match(/>\s*[A-Za-zÄÖÜäöü][^<>{}]*</g) ?? [], f).toEqual([]);
      }
  });
});

describe('a pack is used the moment it is stored (v3 checked the pack store per tile request)', () => {
  const A = bytesOf(500, 1);
  const url = '/api/p/demo/packs/h1/osm.pmtiles';
  const make = () => {
    const server = fakeServer([fakePack('innen', 'h1', [{ layer: 'osm', bytes: A }])], { [url]: A });
    return createOffline({ storage: memoryPackStorage(), transport: server });
  };

  it('rings when a download turns ready, with the layer routed through the pack, and when the pack is deleted', async () => {
    const offline = make();
    await offline.ready;
    const seen: boolean[] = [];
    const stop = onReadyPacksChange(offline.manager, () => seen.push(offline.packProtocol.has('osm')));
    await offline.manager.refresh(); // absent: no change
    expect(seen).toEqual([]);
    await offline.manager.download(['innen']);
    expect(seen).toEqual([true]); // routed when the map is told
    await offline.manager.remove(['innen']);
    expect(seen).toEqual([true, false]);
    stop();
    await offline.manager.download(['innen']);
    expect(seen).toHaveLength(2); // unsubscribed
  });

  it('does not ring for the state at subscribing, nor for progress of a running download', async () => {
    const offline = make();
    await offline.manager.sync();
    let rings = 0;
    onReadyPacksChange(offline.manager, () => (rings += 1));
    expect(rings).toBe(0);
    await offline.manager.sync(); // unchanged
    expect(rings).toBe(0);
  });
});

describe('isIos (WP-810)', () => {
  const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
  const ipad =
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
  const mac =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
  it('is true for iPhone and iPad, and for the iPadOS desktop UA with touch', () => {
    expect(isIos(iphone, 'iPhone', 5)).toBe(true);
    expect(isIos(ipad, 'iPad', 5)).toBe(true);
    expect(isIos(mac, 'MacIntel', 5)).toBe(true);
  });
  it('is false for a Mac without touch, Android and desktop browsers', () => {
    expect(isIos(mac, 'MacIntel', 0)).toBe(false);
    expect(
      isIos('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36', 'Linux armv81', 5),
    ).toBe(false);
    expect(isIos('Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36', 'Linux x86_64', 0)).toBe(false);
  });
  it('the state carries it', () => {
    expect(createPwa(pwaEnv({ ios: () => true }).env).get().ios).toBe(true);
    expect(createPwa(pwaEnv().env).get().ios).toBe(false);
  });
});
