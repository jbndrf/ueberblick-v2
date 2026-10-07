import { describe, expect, it } from 'vitest';
import { mergePrefs, type PrefEntry, type PrefStore } from '@ueberblick/core';
import { createPrefsClient, prefsCacheKey, type KeyValueStorage, type PrefsTransport } from './index';

const T = (s: number): string => `2026-10-01T08:00:${String(s).padStart(2, '0')}.000Z`;

const memoryStorage = (): KeyValueStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  };
};

/** A server that merges like the real one; `offline` makes every call fail. */
function fakeServer() {
  let record: PrefStore = {};
  const s = {
    offline: false,
    calls: [] as string[],
    get record() {
      return record;
    },
    transport: {
      fetch: async () => {
        s.calls.push('fetch');
        if (s.offline) throw new Error('offline');
        return { entries: record };
      },
      send: async (entries: readonly PrefEntry[]) => {
        s.calls.push('send');
        if (s.offline) throw new Error('offline');
        record = mergePrefs(record, entries);
        return { entries: record };
      },
    } satisfies PrefsTransport,
  };
  return s;
}

function device(server: ReturnType<typeof fakeServer>, clockAt: { t: number }, storage = memoryStorage()) {
  return {
    storage,
    client: createPrefsClient({
      storage,
      transport: server.transport,
      clock: { now: () => T(clockAt.t) },
      project: 'trees',
      participant: 'mia',
    }),
  };
}

describe('device cache and offline edits', () => {
  it('a new device gets the record before the map opens (sync), then reads it offline from the cache', async () => {
    const server = fakeServer();
    const phone = device(server, { t: 1 });
    phone.client.set('ui.theme', 'dark');
    await phone.client.sync();

    const tablet = device(server, { t: 5 });
    expect(tablet.client.current().ui.theme).toBeUndefined();
    expect(await tablet.client.sync()).toBe(true);
    expect(tablet.client.current().ui.theme).toBe('dark');

    server.offline = true;
    const reopened = device(server, { t: 6 }, tablet.storage);
    expect(reopened.client.current().ui.theme).toBe('dark');
  });

  it('edits offline show at once, are kept across a reload, and are sent by the next sync', async () => {
    const server = fakeServer();
    server.offline = true;
    const a = device(server, { t: 2 });
    a.client.set('tools.chat', true);
    expect(a.client.current().tools['chat']).toBe(true);
    expect(await a.client.sync()).toBe(false);
    expect(a.client.pending()).toHaveLength(1);

    const reloaded = device(server, { t: 3 }, a.storage);
    expect(reloaded.client.current().tools['chat']).toBe(true);
    server.offline = false;
    expect(await reloaded.client.sync()).toBe(true);
    expect(reloaded.client.pending()).toEqual([]);
    expect(server.record['tools.chat']?.value).toBe(true);
  });

  it('two devices change different keys offline: both survive; the same key: the later time wins', async () => {
    const server = fakeServer();
    server.offline = true;
    const clockA = { t: 10 };
    const clockB = { t: 20 };
    const a = device(server, clockA);
    const b = device(server, clockB);
    a.client.set('ui.locale', 'de');
    a.client.set('ui.theme', 'light'); // earlier
    b.client.set('tools.chat', true);
    b.client.set('ui.theme', 'dark'); // later
    server.offline = false;
    await b.client.sync();
    await a.client.sync();
    await b.client.sync();
    for (const d of [a, b]) {
      const p = d.client.current();
      expect(p.ui).toEqual({ locale: 'de', theme: 'dark' });
      expect(p.tools).toEqual({ chat: true });
    }
  });

  it('an edit made while a sync is in flight is not lost', async () => {
    const server = fakeServer();
    const d = device(server, { t: 1 });
    d.client.set('ui.theme', 'dark');
    const flight = d.client.sync();
    d.client.set('ui.locale', 'de');
    await flight;
    expect(d.client.current().ui).toEqual({ theme: 'dark', locale: 'de' });
    expect(d.client.pending().map((p) => p.path)).toEqual(['ui.locale']);
    await d.client.sync();
    expect(server.record['ui.locale']?.value).toBe('de');
  });

  it('a slow clock does not lose to its own earlier edit', async () => {
    const server = fakeServer();
    const clock = { t: 30 };
    const d = device(server, clock);
    d.client.set('ui.theme', 'dark');
    await d.client.sync();
    clock.t = 5;
    d.client.set('ui.theme', 'light');
    await d.client.sync();
    expect(d.client.current().ui.theme).toBe('light');
    expect(server.record['ui.theme']?.value).toBe('light');
  });

  it('refuses an unknown key or a wrong type, and keeps people apart in the cache', async () => {
    const server = fakeServer();
    const d = device(server, { t: 1 });
    expect(() => d.client.set('colour', 'red')).toThrow();
    expect(() => d.client.set('ui.theme', 'purple')).toThrow();
    d.client.set('ui.theme', 'dark');
    expect([...d.storage.data.keys()]).toEqual([prefsCacheKey('trees', 'mia')]);
    const other = createPrefsClient({
      storage: d.storage,
      transport: server.transport,
      clock: { now: () => T(2) },
      project: 'trees',
      participant: 'bernd',
    });
    expect(other.current().ui.theme).toBeUndefined();
  });

  it('tells subscribers about every change, and survives a damaged cache', async () => {
    const server = fakeServer();
    const storage = memoryStorage();
    storage.set(prefsCacheKey('trees', 'mia'), '{not json');
    const d = device(server, { t: 1 }, storage);
    const seen: (string | undefined)[] = [];
    const off = d.client.subscribe((p) => seen.push(p.ui.theme));
    d.client.set('ui.theme', 'dark');
    off();
    d.client.set('ui.theme', 'light');
    expect(seen).toEqual(['dark']);
  });
});
