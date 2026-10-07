import type { Clock } from '@ueberblick/core/ports';
import {
  PREF_INSTANT,
  isJson,
  mergePrefs,
  prefsOf,
  validatePrefValue,
  type PrefEntry,
  type PrefStore,
} from '@ueberblick/core/prefs';
import type { KeyValueStorage, PrefsClient, PrefsListener, PrefsTransport } from './contract';

export interface PrefsClientDeps {
  readonly storage: KeyValueStorage;
  readonly transport: PrefsTransport;
  readonly clock: Clock;
  readonly project: string;
  /** The signed-in person (participant or admin id): the cache is per person, so two people on one device never mix. */
  readonly participant: string;
}

interface Cached {
  readonly server: PrefStore;
  readonly pending: readonly PrefEntry[];
}

/** The cache key. Device-only settings (Offline-Bilder, tile pack, remembered tab) are NOT in this record. */
export const prefsCacheKey = (project: string, participant: string): string =>
  `ueberblick.prefs.${encodeURIComponent(project)}.${encodeURIComponent(participant)}`;

function load(storage: KeyValueStorage, key: string): Cached {
  try {
    const raw = storage.get(key);
    if (raw !== null) {
      const v = JSON.parse(raw) as Partial<Cached>;
      if (v.server !== undefined && Array.isArray(v.pending)) {
        return { server: v.server, pending: v.pending.filter(isEntry) };
      }
    }
  } catch {
    // a missing or damaged cache is an empty cache; the next sync refills it
  }
  return { server: {}, pending: [] };
}

const isEntry = (e: unknown): e is PrefEntry => {
  const x = e as PrefEntry;
  return typeof x?.path === 'string' && PREF_INSTANT.test(x.at) && isJson(x.value);
};

/**
 * The device side of the personal preference record (WP-612): a cache per project and person, edits that work offline,
 * and last write wins per key against the server copy (`mergePrefs`). It needs no schema step in `store/**`.
 */
export function createPrefsClient(deps: PrefsClientDeps): PrefsClient {
  const key = prefsCacheKey(deps.project, deps.participant);
  let state = load(deps.storage, key);
  const listeners = new Set<PrefsListener>();
  const merged = (): PrefStore => mergePrefs(state.server, state.pending);
  const commit = (next: Cached): void => {
    state = next;
    try {
      deps.storage.set(key, JSON.stringify(state));
    } catch {
      // storage full or blocked: the edit still holds in memory for this session
    }
    const prefs = prefsOf(merged());
    for (const fn of listeners) fn(prefs);
  };
  let syncing: Promise<boolean> | undefined;

  async function run(): Promise<boolean> {
    const sent = state.pending;
    try {
      const reply = sent.length === 0 ? await deps.transport.fetch() : await deps.transport.send(sent);
      // Edits made while the request was in flight stay pending; the ones sent are in the server's answer.
      const stillPending = state.pending.filter((p) => !sent.includes(p));
      commit({ server: mergePrefs(reply.entries, []), pending: stillPending });
      return true;
    } catch {
      return false;
    }
  }

  return {
    current: () => prefsOf(merged()),
    entries: merged,
    pending: () => state.pending,
    set(path, value) {
      const ok = validatePrefValue(path, value);
      if (!ok.ok) throw new Error(ok.message);
      const entry: PrefEntry = { path, value, at: stamp(deps.clock.now(), state, path) };
      commit({ server: state.server, pending: [...state.pending.filter((p) => p.path !== path), entry] });
    },
    sync() {
      // One flight at a time; a caller during a flight gets that flight's answer, and a following sync() sends the rest.
      syncing ??= run().finally(() => {
        syncing = undefined;
      });
      return syncing;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** The device clock, but never behind the time already on this key, so a slow clock cannot lose to its own earlier edit. */
function stamp(now: string, state: Cached, path: string): string {
  const known = [state.server[path]?.at, ...state.pending.filter((p) => p.path === path).map((p) => p.at)];
  const latest = known
    .filter((t): t is string => t !== undefined)
    .sort()
    .at(-1);
  if (latest === undefined || now > latest) return now;
  return new Date(Date.parse(latest) + 1).toISOString();
}
