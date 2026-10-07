/**
 * The platform behind `DevicePorts`: fetch, IndexedDB, localStorage, Web Locks, the SSE doorbell and the page
 * lifecycle. Thin on purpose (no logic to test in isolation); the browser e2e exercises it. Part of the lazy device chunk.
 */
import {
  browserStoragePort,
  browserTabs,
  sseToolDoorbell,
  type IdbEnv,
  type KeyedSignal,
  type LockManagerLike,
  type Signal,
  type WorkerPortLike,
} from '@ueberblick/client';
import { sharedEvents, type EventSourceCtor } from './browser-events';
import type { DevicePorts } from './device';
import { createNetwork, type Network } from './network';

/** The page came back into view or into focus. */
const visibleSignal: Signal = {
  subscribe(fn) {
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') fn();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', fn);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', fn);
    };
  },
};

/** The server's SSE stream: an `EventSource` reconnects by itself; the sync doorbell and the tool doorbell share it. */
const events = sharedEvents(EventSource as unknown as EventSourceCtor);

/** Each `seq` event rings once. */
const doorbell = (project: string): Signal => ({
  subscribe(fn) {
    const source = events.open(project);
    source.addEventListener('seq', fn);
    return () => source.close();
  },
});

/** Each `tool` event rings with the tool key (B-020): the device then pulls that tool's stream. */
const toolDoorbell = (project: string): KeyedSignal => sseToolDoorbell(() => events.open(project));

/** The browser's online, offline and visibility events as one signal for the reachability pings. */
const networkChanged: Signal = {
  subscribe(fn) {
    window.addEventListener('online', fn);
    window.addEventListener('offline', fn);
    document.addEventListener('visibilitychange', fn);
    return () => {
      window.removeEventListener('online', fn);
      window.removeEventListener('offline', fn);
      document.removeEventListener('visibilitychange', fn);
    };
  },
};

/** One reachability source per page, however often a device is opened (R1). */
let pageNetwork: Network | undefined;

function theNetwork(): Network {
  if (pageNetwork !== undefined) return pageNetwork;
  const network = createNetwork({
    fetch: (input, init) => fetch(input, { credentials: 'same-origin', ...init }),
    timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as never) },
    browserOnline: () => navigator.onLine,
    pageVisible: () => document.visibilityState === 'visible',
    changed: networkChanged,
  });
  network.start();
  pageNetwork = network;
  return network;
}

export function browserPorts(onError: DevicePorts['onError']): DevicePorts {
  const network = theNetwork();
  return {
    fetch: (input, init) => fetch(input, { credentials: 'same-origin', ...init }),
    idb: { factory: indexedDB, keyRange: IDBKeyRange } as unknown as IdbEnv,
    storage: localStorage,
    health: browserStoragePort(window),
    // The sync pipeline (engine, page decoding, cache writes) runs in a dedicated Web Worker (WP-567, B-012).
    sync: {
      mode: 'worker',
      // Only the tab holding the Web Lock of this database runs the sync worker; the others follow it (WP-572).
      tabs: (name) => browserTabs(name),
      // A `Worker` is a `WorkerPortLike` (its `onerror` event is typed narrower than the port's `unknown`).
      start: () =>
        new Worker(new URL('./sync.worker.ts', import.meta.url), {
          type: 'module',
        }) as unknown as WorkerPortLike & { terminate(): void },
    },
    clock: { now: () => new Date().toISOString() as never },
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as never) },
    mono: () => performance.now(),
    locks: 'locks' in navigator ? (navigator.locks as unknown as LockManagerLike) : undefined,
    network,
    visible: visibleSignal,
    doorbell,
    toolDoorbell,
    onError,
  };
}
