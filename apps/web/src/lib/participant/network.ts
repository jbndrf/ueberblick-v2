/**
 * Online means the server answers (v3 `network.svelte.ts` `pingServer` / `checkBackendReachable`): `navigator.onLine`
 * alone is true on a captive portal or behind a dead server, so nobody could believe their work was sent. This is the
 * one reachability source (R1): the status UI, "Jetzt synchronisieren", the queue's sends and the sync triggers read it.
 * It pings `/api/health` every `PING_INTERVAL_MS` while the page is visible. Time comes through the `Timers` port.
 */
import type { Signal, Timers } from '@ueberblick/client';
import type { FetchLike } from './http';

export const HEALTH_URL = '/api/health';
export const PING_INTERVAL_MS = 5_000;
export const PING_TIMEOUT_MS = 5_000;

export interface Network {
  /** True when the browser says online and the last ping was answered. */
  current(): boolean;
  subscribe(onChange: (reachable: boolean) => void): () => void;
  /** Rings when the server became reachable again (the sync triggers' "online"). */
  readonly becameReachable: Signal;
  /** Pings now (a person pressing "Jetzt synchronisieren" or the page coming back). */
  check(): Promise<boolean>;
  start(): void;
  stop(): void;
}

export interface NetworkDeps {
  readonly fetch: FetchLike;
  readonly timers: Timers;
  /** `navigator.onLine`. */
  readonly browserOnline: () => boolean;
  /** `document.visibilityState === 'visible'`. */
  readonly pageVisible: () => boolean;
  /** The browser's online, offline and visibility events. */
  readonly changed: Signal;
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
}

export function createNetwork(deps: NetworkDeps): Network {
  const interval = deps.intervalMs ?? PING_INTERVAL_MS;
  const timeout = deps.timeoutMs ?? PING_TIMEOUT_MS;
  const listeners = new Set<(reachable: boolean) => void>();
  const rings = new Set<() => void>();
  let reachable = deps.browserOnline();
  let timer: unknown;
  let stopEvents: (() => void) | undefined;
  let round = 0;

  const set = (next: boolean): void => {
    if (next === reachable) return;
    reachable = next;
    listeners.forEach((l) => l(next));
    if (next) rings.forEach((r) => r());
  };

  const ping = async (): Promise<boolean> => {
    const controller = new AbortController();
    let handle: unknown;
    const late = new Promise<false>((resolve) => {
      handle = deps.timers.set(() => {
        controller.abort();
        resolve(false);
      }, timeout);
    });
    const answer = deps
      .fetch(HEALTH_URL, { method: 'GET', cache: 'no-store', signal: controller.signal })
      .then(
        (r) => r.ok,
        () => false,
      );
    try {
      return await Promise.race([answer, late]);
    } finally {
      deps.timers.clear(handle);
    }
  };

  const schedule = (): void => {
    deps.timers.clear(timer);
    timer = undefined;
    if (stopEvents === undefined || !deps.pageVisible()) return; // no pings while hidden
    timer = deps.timers.set(() => void check(), interval);
  };

  async function check(): Promise<boolean> {
    const mine = ++round;
    const answered = deps.browserOnline() ? await ping() : false;
    if (mine === round) {
      set(answered);
      schedule();
    }
    return answered;
  }

  return {
    current: () => reachable,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    becameReachable: {
      subscribe(fn) {
        rings.add(fn);
        return () => rings.delete(fn);
      },
    },
    check,
    start() {
      if (stopEvents !== undefined) return;
      stopEvents = deps.changed.subscribe(() => {
        if (!deps.browserOnline()) {
          round++;
          set(false);
        }
        if (deps.pageVisible()) void check();
        else schedule();
      });
      if (deps.pageVisible()) void check();
    },
    stop() {
      stopEvents?.();
      stopEvents = undefined;
      round++;
      deps.timers.clear(timer);
      timer = undefined;
    },
  };
}
