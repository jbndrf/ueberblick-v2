import type { PrefEntry } from '@ueberblick/core/prefs';
import type { KeyValueStorage, PrefsReply, PrefsTransport } from './contract';

/** `localStorage` as a `KeyValueStorage`. Every call is guarded: private windows and blocked storage throw. */
export function webKeyValueStorage(storage: Storage): KeyValueStorage {
  return {
    get: (k) => {
      try {
        return storage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => storage.setItem(k, v),
    remove: (k) => {
      try {
        storage.removeItem(k);
      } catch {
        // nothing to remove
      }
    },
  };
}

/** The HTTP transport of `/api/p/<project>/prefs`. A non-2xx answer rejects, so the client keeps its pending edits. */
export function httpPrefsTransport(project: string, fetchFn: typeof fetch = fetch): PrefsTransport {
  const url = `/api/p/${encodeURIComponent(project)}/prefs`;
  const read = async (res: Response): Promise<PrefsReply> => {
    if (!res.ok) throw new Error(`prefs: HTTP ${res.status}`);
    return (await res.json()) as PrefsReply;
  };
  return {
    fetch: async () => read(await fetchFn(url, { credentials: 'same-origin' })),
    send: async (entries: readonly PrefEntry[]) =>
      read(
        await fetchFn(url, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entries }),
        }),
      ),
  };
}
