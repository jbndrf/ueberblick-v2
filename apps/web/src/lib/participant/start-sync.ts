/**
 * The ONE place the device wires sync (WP-550, worker host WP-567). It opens the sync host (the sync engine and the
 * cache writes in a dedicated Web Worker, or in this thread; the app picks the mode, there is no silent fallback),
 * builds the run queue over the host's store, hands the queue to the worker as its `PredictionRefresher`, tells the
 * queue how far each pull reached (`onPulled`), and lets the lifecycle signals end a queue backoff (`resetBackoff` on
 * online and on focus) and send what is queued. The queue retries itself after a backoff; `stop` closes it.
 *
 * The queue needs the store and the host needs the queue (to re-predict after a reset), so the caller passes
 * `queueFor(store)` and the host gets a forwarding refresher that is filled in once the queue exists.
 */
import {
  createAutoSync,
  openSyncHost,
  type AutoSync,
  type DeviceStore,
  type DrainResult,
  type OpenOptions,
  type PredictionRefresher,
  type PullResult,
  type Signal,
  type SyncHost,
  type SyncHostOptions,
  type ToolSync,
  type SyncTransport,
  type SyncWorker,
  type TabCoordination,
  type VersionsSink,
  type Timers,
  type WorkerPortLike,
  type SINGLE_TAB,
} from '@ueberblick/client';
import type { Instant, Seq } from '@ueberblick/core/model';
import type { SyncResetReason, SyncTrigger } from '@ueberblick/core/registry';
import { WORKER_CONFIG_PARTICIPANT, WORKER_CONFIG_PROJECT } from './sync-worker-side';

/** The slice of the run queue that sync talks to. */
export interface SyncQueue extends PredictionRefresher {
  onPulled(seq: Seq): Promise<void>;
  resetBackoff(): void;
  drain(): Promise<DrainResult>;
  /** `awaitingPull`: accepted runs that no pull has covered yet. */
  status(): { readonly awaitingPull: number };
  subscribe(listener: () => void): () => void;
  /** Cancels the queue's own retry timer (the queue retries itself after a backoff). */
  close(): void;
}

/** Where the sync pipeline runs. `start` creates the `Worker` (its entry is `sync.worker.ts`). */
export type SyncHostChoice =
  | { readonly mode: 'in-thread' }
  | {
      readonly mode: 'worker';
      readonly start: () => WorkerPortLike & { terminate(): void };
      /** Several tabs of one database share one sync (WP-572): the coordination for the store's name. */
      readonly tabs: (name: string) => TabCoordination | typeof SINGLE_TAB;
    };

export interface StartSyncDeps {
  /** One host per store name: the participant and project. */
  readonly name: string;
  readonly project: string;
  /** The participant the device works as: the worker guards its requests against a session turned to another (WP-768). */
  readonly participant: string;
  /** The device store's platform: `env`, the eviction `marker`, `onIssue`. */
  readonly options: OpenOptions;
  readonly host: SyncHostChoice;
  /** Used by the in-thread host; the worker builds its own from `sync-worker-side.ts`. */
  readonly transport: SyncTransport;
  readonly clock: { now(): Instant };
  readonly timers: Timers;
  readonly doorbell: Signal;
  /** Rings when the server became reachable again (WP-734). */
  readonly online: Signal;
  /** Whether the server answers now; no send is attempted while it does not. Default: always. */
  readonly reachable?: () => boolean;
  readonly visible: Signal;
  /** Where the sync pages' config versions go (WP-669): both hosts feed it, whichever thread the engine runs on. */
  readonly versions?: VersionsSink;
  /** The tool streams (`ctx.data`): synced on open, online and visible, and pulled on their own doorbell (WP-684). */
  readonly tools?: ToolSync;
  /** Builds the run queue (and what it needs) over the host's store. */
  readonly queueFor: (store: DeviceStore) => Promise<SyncQueue>;
  /** Test seam: the default is the client's `openSyncHost`. */
  readonly openHost?: (options: SyncHostOptions) => Promise<SyncHost>;
  /**
   * The person's access may have changed (WP-784), so who they are is read again: a pull ended in a scope change, or
   * the person asked to sync now. A role change that leaves the scope as it was shows no scope change, hence the second.
   */
  readonly onAccessCheck?: () => void;
  /**
   * The baseline of the pull header's `access` from the bootstrap (WP-798). The first pull that reports a different
   * value rings `onAccessCheck`; absent, the first pull is the baseline.
   */
  readonly access?: string;
  readonly onError?: (trigger: SyncTrigger | 'now' | 'host', error: unknown) => void;
}

export interface SyncHandle {
  /** The store the app reads and the queue writes through (a read replica in worker mode). */
  readonly store: DeviceStore;
  readonly queue: SyncQueue;
  /** The worker as the app reads it (status, subscribe); its `pull` also informs the queue. */
  readonly worker: SyncWorker;
  /** "Sync now": ends a backoff, pulls, and sends the queue. */
  syncNow(): Promise<void>;
  /** Lets go of the signals and closes the host (terminates the worker, closes the store). */
  stop(): void;
}

function hostOptions(deps: StartSyncDeps, predictions: PredictionRefresher): SyncHostOptions {
  const { host } = deps;
  if (host.mode === 'in-thread')
    return {
      mode: 'in-thread',
      name: deps.name,
      options: deps.options,
      transport: deps.transport,
      predictions,
      clock: deps.clock,
      ...(deps.versions ? { versions: deps.versions } : {}),
    };
  const worker = host.start();
  return {
    mode: 'worker',
    name: deps.name,
    options: deps.options,
    port: worker,
    config: { [WORKER_CONFIG_PROJECT]: deps.project, [WORKER_CONFIG_PARTICIPANT]: deps.participant },
    predictions,
    ...(deps.versions ? { versions: deps.versions } : {}),
    tabs: host.tabs(deps.name),
    onFault: (e: Error) => deps.onError?.('host', e),
    onDispose: () => worker.terminate(),
  };
}

/** How long opening the sync host may take. A worker that never answers (its script not loadable) ends the start. */
export const HOST_OPEN_TIMEOUT_MS = 15_000;

/**
 * Opens the host, or fails after `HOST_OPEN_TIMEOUT_MS` (WP-717): a start never waits for a worker for good. The
 * session then shows the load error with a retry. A host that arrives late is closed, and the worker is terminated.
 */
async function openWithin(deps: StartSyncDeps, options: SyncHostOptions): Promise<SyncHost> {
  const opening = (deps.openHost ?? openSyncHost)(options);
  let handle: unknown;
  const late = new Promise<never>((_, reject) => {
    handle = deps.timers.set(
      () => reject(new Error(`The sync host did not open within ${HOST_OPEN_TIMEOUT_MS / 1000} s.`)),
      HOST_OPEN_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([opening, late]);
  } catch (e) {
    if (options.mode === 'worker') options.onDispose?.();
    opening.then((h) => h.dispose()).catch(() => undefined);
    throw e;
  } finally {
    deps.timers.clear(handle);
  }
}

export async function startSync(deps: StartSyncDeps): Promise<SyncHandle> {
  const ref: { queue?: SyncQueue } = {};
  const predictions: PredictionRefresher = {
    rederive(reason: SyncResetReason) {
      if (ref.queue === undefined) return Promise.reject(new Error('The run queue is not open yet.'));
      return ref.queue.rederive(reason);
    },
  };
  const host = await openWithin(deps, hostOptions(deps, predictions));
  let queue: SyncQueue;
  try {
    queue = await deps.queueFor(host.store);
  } catch (e) {
    host.dispose(); // never leave a worker or a store connection behind a failed start
    throw e;
  }
  ref.queue = queue;
  let seed = deps.access; // consumed by the first pull that reports an access value

  // Every pull, whoever asks for it, ends with the queue told how far the store is current.
  const worker: SyncWorker = {
    ...host.sync,
    async pull(): Promise<PullResult> {
      const result = await host.sync.pull();
      await queue.onPulled(result.cursor);
      const seeded = seed !== undefined && result.access !== undefined;
      const missed = seeded && seed !== result.access;
      if (seeded) seed = undefined;
      if (result.reset === 'scope_changed' || result.accessChanged === true || missed) {
        // The roles are read again only once a send in flight has settled: a device reopened under a run that is
        // being sent would write its answer into a closed database (WP-792).
        await queue.drain().catch((e: unknown) => deps.onError?.('online', e));
        deps.onAccessCheck?.();
      }
      return result;
    },
  };
  const reachable = deps.reachable ?? ((): boolean => true);
  const resume = (): void => {
    if (!reachable()) return;
    queue.resetBackoff();
    queue.drain().catch((e: unknown) => deps.onError?.('online', e));
  };
  const auto: AutoSync = createAutoSync({
    worker,
    timers: deps.timers,
    doorbell: deps.doorbell,
    online: { subscribe: (fn) => deps.online.subscribe(() => (resume(), fn())) },
    visible: { subscribe: (fn) => deps.visible.subscribe(() => (resume(), fn())) },
    ...(deps.tools === undefined ? {} : { tools: deps.tools }),
    onError: (trigger, error) => deps.onError?.(trigger, error),
  });

  // A run the server accepted is only shown as synced once a pull carries it. The doorbell rings that pull, but a
  // device that started offline has no stream yet, so the queue itself asks: once per wait (WP-865).
  let waiting = queue.status().awaitingPull;
  const stopWaiting = queue.subscribe(() => {
    const now = queue.status().awaitingPull;
    const grew = now > waiting;
    waiting = now;
    if (grew) worker.pull().catch((e: unknown) => deps.onError?.('doorbell', e));
  });

  auto.start();
  return {
    store: host.store,
    queue,
    worker,
    async syncNow() {
      if (!reachable()) return;
      queue.resetBackoff();
      await worker.pull().catch((e: unknown) => deps.onError?.('now', e));
      await queue.drain();
    },
    stop() {
      auto.stop();
      stopWaiting();
      queue.close();
      host.dispose();
    },
  };
}
