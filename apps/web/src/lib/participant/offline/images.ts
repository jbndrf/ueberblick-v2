// Offline-Bilder (v3 `SettingsSheet.svelte:740-800`, `handleToggleFullLocalCopy` :301-325): with the switch on, thumbnails
// of the photos in scope are kept on the device so images show offline; with it off, none are, and a switch turned off
// removes what was kept. The switch is the person's preference (`ui.offline_images`), so it follows the person to a new
// device, where the thumbnails then come at the start. Headless: the cache, the server and the preference are ports.
import { downloadThumbs, type ThumbCache, type ThumbProgress, type ThumbTransport } from '@ueberblick/client';
import { defineRegistry, type KeyOf } from '@ueberblick/core/registry';

export const IMAGES_PHASES = defineRegistry([
  { key: 'idle', description: 'Nothing is running.' },
  { key: 'downloading', description: 'Thumbnails are being saved (v3: "Downloading thumbnails...").' },
  {
    key: 'removing',
    description: 'The saved thumbnails are being removed (v3: "Removing cached images...").',
  },
] as const);
export type ImagesPhase = KeyOf<typeof IMAGES_PHASES>;

export interface ImagesState extends ThumbProgress {
  readonly enabled: boolean;
  readonly phase: ImagesPhase;
}

export interface ImagesPrefs {
  enabled(): boolean;
  /** Writes the personal preference (the record syncs it). */
  set(on: boolean): void;
  /** After every change of the record, also one that came from another device. */
  subscribe(fn: () => void): () => void;
}

export interface OfflineImagesDeps {
  readonly cache: ThumbCache;
  readonly transport: ThumbTransport;
  readonly prefs: ImagesPrefs;
  /** The sha256 of every image the device holds a feature for. */
  photosInScope(): Promise<readonly string[]>;
  readonly online: () => boolean;
}

export interface OfflineImages {
  /** False without IndexedDB: the card is not offered. */
  readonly supported: boolean;
  /** What photo URLs read from. */
  readonly cache: Pick<ThumbCache, 'get'>;
  state(): ImagesState;
  subscribe(fn: (s: ImagesState) => void): () => void;
  /** The switch. On downloads (when online), off removes. */
  setEnabled(on: boolean): Promise<void>;
  /** Call once the app is open: follows the preference and, when it is on, fills the cache. `stop` ends it. */
  start(): Promise<void>;
  stop(): void;
  /** The photos in scope may have changed (a sync, the connection came back): fetch the ones missing. */
  refresh(): Promise<void>;
  /** The "Dateien" count of Speicher. */
  files(): Promise<number>;
  /** Resolves when nothing is running (specs). */
  idle(): Promise<void>;
}

export function createOfflineImages(deps: OfflineImagesDeps): OfflineImages {
  const { cache, prefs } = deps;
  let state: ImagesState = { enabled: prefs.enabled(), phase: 'idle', done: 0, total: 0 };
  const listeners = new Set<(s: ImagesState) => void>();
  let abort: AbortController | undefined;
  let chain: Promise<void> = Promise.resolve();
  let unsubscribe: (() => void) | undefined;

  const set = (patch: Partial<ImagesState>): void => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l(state));
  };
  // one job at a time: a switch flipped during a download waits for it to stop
  const queue = (job: () => Promise<void>): Promise<void> => (chain = chain.then(job, job));

  /**
   * Thumbnails of photos that left the device's scope go (WP-770): an erased photo (its feature value is blanked), a
   * hidden feature, a lost role. Cost: one key-only read of the cache and a set difference, plus the scan of the
   * photos in scope that `fill` makes anyway; it needs no network, so it also runs offline.
   */
  async function prune(shas: readonly string[], signal: AbortSignal): Promise<void> {
    const inScope = new Set(shas);
    for (const sha of await cache.keys()) {
      if (signal.aborted) return;
      if (!inScope.has(sha)) await cache.remove(sha);
    }
  }

  async function fill(): Promise<void> {
    if (!cache.supported || !prefs.enabled()) return;
    const ctl = (abort = new AbortController());
    const online = deps.online();
    if (online) set({ enabled: true, phase: 'downloading', done: 0, total: 0 });
    try {
      const shas = await deps.photosInScope();
      await prune(shas, ctl.signal);
      if (!online) return;
      set({ total: shas.length });
      await downloadThumbs({
        shas,
        cache,
        transport: deps.transport,
        signal: ctl.signal,
        onProgress: (p) => set({ done: p.done, total: p.total }),
      });
    } finally {
      if (abort === ctl) abort = undefined;
      if (online) set({ phase: 'idle' });
    }
  }

  async function drop(): Promise<void> {
    set({ enabled: false, phase: 'removing' });
    try {
      await cache.clear();
    } finally {
      set({ phase: 'idle', done: 0, total: 0 });
    }
  }

  function follow(): void {
    const on = prefs.enabled();
    if (on === state.enabled) return; // already following (the switch itself, or a repeat)
    if (on) void queue(fill);
    else {
      abort?.abort();
      void queue(drop);
    }
  }

  return {
    supported: cache.supported,
    cache,
    state: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    async setEnabled(on) {
      if (on === prefs.enabled() && on === state.enabled) return;
      set({ enabled: on });
      if (!on) abort?.abort();
      prefs.set(on); // the record rings `follow`, which sees `enabled` already settled and does nothing
      await queue(on ? fill : drop);
    },
    async start() {
      unsubscribe ??= prefs.subscribe(follow);
      set({ enabled: prefs.enabled() });
      await queue(fill);
    },
    stop() {
      abort?.abort();
      unsubscribe?.();
      unsubscribe = undefined;
    },
    refresh: () => queue(fill),
    files: () => cache.count(),
    idle: async () => {
      await chain;
    },
  };
}
