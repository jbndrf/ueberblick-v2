import { describe, expect, it } from 'vitest';
import { mergePrefs, type PrefEntry, type PrefStore } from '@ueberblick/core';
import { createPrefsClient, type KeyValueStorage, type PrefsClient } from '@ueberblick/client';
import { memoryStorage } from './fake-device.testing';
import { PREF_KEYS, createDevicePrefs, type PrefsPort } from './prefs';
import { bindLookToRecord, createRecordPrefs } from './prefs-record';

const T = (s: number): string => `2026-10-01T08:00:${String(s).padStart(2, '0')}.000Z`;
const kv = (): KeyValueStorage => {
  const data = new Map<string, string>();
  return {
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  };
};

function fakeServer() {
  let record: PrefStore = {};
  const s = {
    offline: false,
    transport: {
      fetch: async () => {
        if (s.offline) throw new Error('offline');
        return { entries: record };
      },
      send: async (entries: readonly PrefEntry[]) => {
        if (s.offline) throw new Error('offline');
        record = mergePrefs(record, entries);
        return { entries: record };
      },
    },
  };
  return s;
}

function phone(server: ReturnType<typeof fakeServer>, t: number, dark = false) {
  const client: PrefsClient = createPrefsClient({
    storage: kv(),
    transport: server.transport,
    clock: { now: () => T(t) },
    project: 'trees',
    participant: 'mia',
  });
  const storage = memoryStorage();
  const device: PrefsPort = createDevicePrefs({ storage, prefersDark: () => dark, deviceLocale: 'de' });
  const port = createRecordPrefs({ client, device });
  return { client, storage, device, port };
}

const root = () => {
  const r = {
    dark: false,
    classList: { toggle: (_: string, force: boolean) => void (r.dark = force) },
    style: { fontSize: '' },
  };
  return r;
};

describe('look prefs follow the person (WP-695)', () => {
  it('a write goes to the record and keeps the device cache the page reads before first paint', () => {
    const p = phone(fakeServer(), 1);
    p.port.write({ theme: 'dark', fontSize: 'large', locale: 'en' });
    expect(p.client.current().ui).toMatchObject({ theme: 'dark', font_size: 'large', locale: 'en' });
    expect(p.storage.getItem(PREF_KEYS.theme)).toBe('dark');
    expect(p.port.read()).toEqual({ theme: 'dark', fontSize: 'large', locale: 'en' });
  });

  it('two devices of one person converge: a change on A shows on B after sync', async () => {
    const server = fakeServer();
    const a = phone(server, 1);
    const b = phone(server, 5);
    a.port.write({ theme: 'dark', fontSize: 'xl' });
    await a.client.sync();
    expect(b.port.read().theme).toBe('light');
    await b.client.sync();
    expect(b.port.read()).toMatchObject({ theme: 'dark', fontSize: 'xl' });
  });

  it('before the record arrives the device value shows; after it, the record wins and the cache follows', async () => {
    const server = fakeServer();
    const a = phone(server, 1);
    a.port.write({ theme: 'dark', locale: 'en' });
    await a.client.sync();
    const b = phone(server, 5);
    b.device.write({ theme: 'light', fontSize: 'small' });
    expect(b.port.read()).toEqual({ theme: 'light', fontSize: 'small', locale: 'de' });
    const r = root();
    const locales: string[] = [];
    const stop = bindLookToRecord({
      client: b.client,
      device: b.device,
      port: b.port,
      root: r,
      locale: 'de',
      onlocale: (l) => locales.push(l),
    });
    await b.client.sync();
    expect(b.port.read()).toEqual({ theme: 'dark', fontSize: 'small', locale: 'en' });
    expect(r.dark).toBe(true);
    expect(b.storage.getItem(PREF_KEYS.theme)).toBe('dark');
    expect(b.storage.getItem(PREF_KEYS.locale)).toBe('en');
    expect(locales).toEqual(['en']);
    stop();
  });

  it('a change made offline is kept and sent later', async () => {
    const server = fakeServer();
    const a = phone(server, 1);
    server.offline = true;
    a.port.write({ fontSize: 'xs' });
    expect(await a.client.sync()).toBe(false);
    expect(a.port.read().fontSize).toBe('xs');
    expect(a.client.pending()).toHaveLength(1);
    server.offline = false;
    await a.client.sync();
    expect(a.client.pending()).toHaveLength(0);
    const b = phone(server, 9);
    await b.client.sync();
    expect(b.port.read().fontSize).toBe('xs');
  });

  it('a device that refuses to store throws before the record changes', () => {
    const client = phone(fakeServer(), 1).client;
    const device: PrefsPort = {
      read: () => ({ theme: 'light', fontSize: 'medium', locale: 'de' }),
      write: () => {
        throw new Error('full');
      },
    };
    const port = createRecordPrefs({ client, device });
    expect(() => port.write({ theme: 'dark' })).toThrow('full');
    expect(client.current().ui.theme).toBeUndefined();
  });

  it('a stray record value never reaches the page: the device value stands', () => {
    const p = phone(fakeServer(), 1);
    p.client.set('ui.locale', 'fr'); // legal for the record, not a language of the app
    expect(p.port.read().locale).toBe('de');
  });
});
