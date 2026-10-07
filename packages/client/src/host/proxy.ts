/**
 * The main-thread side of the worker sync host (B-012). The app holds a read replica of the device store and a
 * `SyncWorker` proxy. Reads answer from the replica's memory, exactly as before; the worker's commits reach it
 * as notices and are applied with the store's own `commitPlan`, one notice at a time, in order.
 */
import type { SyncResetReason } from '@ueberblick/core/registry';
import type { CommitNotice } from '../store/commit';
import { sameCursor } from '../store/commit';
import type { DeviceStore, OpenOptions } from '../store/contract';
import { openReplicaStore } from '../store/open';
import type { DeviceStoreImpl } from '../store/store';
import type { MessagePortLike } from '../sync/decode';
import type { PredictionRefresher, PullResult, SyncStatus, SyncWorker } from '../sync/contract';
import type { VersionsSink } from '../config';
import { SINGLE_TAB } from './kinds';
import { openTabs, type TabCoordination, type Tabs } from './tabs';
import {
  HOST_PROTOCOL_VERSION,
  HostProtocolError,
  fromWire,
  parseFromWorker,
  toWire,
  type Body,
  type FromWorker,
  type ToWorker,
} from './protocol';

export interface WorkerPortLike extends MessagePortLike {
  /** A `Worker`'s uncaught error; the host reports it as a fault. */
  onerror?: ((event: unknown) => void) | null;
}

export interface SyncHost {
  /** What the app reads and the run queue writes its own stores through. */
  readonly store: DeviceStore;
  readonly sync: SyncWorker;
  dispose(): void;
}

export interface WorkerHostOptions {
  readonly name: string;
  readonly options: OpenOptions;
  readonly port: WorkerPortLike;
  /** Opaque string settings for the worker's adapters (base URL, headers). */
  readonly config: Readonly<Record<string, string>>;
  readonly predictions: PredictionRefresher;
  /** Config versions from the worker's page headers and completed pulls (WP-669; also fed to followers). */
  readonly versions?: VersionsSink;
  /**
   * Several tabs on one database: only the tab holding the Web Lock runs the worker, the others follow it
   * (`docs/07`, multi-tab). Browser: `browserTabs(name)`. `SINGLE_TAB`: this tab always pulls, on purpose.
   */
  readonly tabs: TabCoordination | typeof SINGLE_TAB;
  /** A worker crash, a refused message, a diverged replica. The host stays usable unless it says otherwise. */
  readonly onFault?: (error: Error) => void;
  /** Called last by `dispose`; the app terminates the `Worker` here. */
  readonly onDispose?: () => void;
}

const IDLE: SyncStatus = {
  phase: 'idle',
  lastSyncedAt: undefined,
  lastSyncedSeq: undefined,
  lastError: undefined,
  featuresLoaded: 0,
};

export async function openWorkerHost(o: WorkerHostOptions): Promise<SyncHost> {
  const { port } = o;
  const replica: DeviceStoreImpl = await openReplicaStore(o.name, o.options);
  const post = (m: Body<ToWorker>) => port.postMessage({ v: HOST_PROTOCOL_VERSION, ...m });

  let status = IDLE;
  const statusListeners = new Set<(s: SyncStatus) => void>();
  let nextPull = 1;
  const pulls = new Map<number, { resolve: (r: PullResult) => void; reject: (e: unknown) => void }>();
  let onReady: ((cursor: CommitNotice['from']) => void) | undefined;
  let tabs: Tabs | undefined;
  let disposed = false;
  /** Slices of a diverged page still to come and to be dropped. */
  let discarding = false;

  const rejectPulls = (error: Error) => {
    for (const p of pulls.values()) p.reject(error);
    pulls.clear();
  };
  const fault = (error: Error) => {
    rejectPulls(error);
    o.onFault?.(error);
  };

  async function apply(notice: CommitNotice): Promise<void> {
    // `blobs` is queue data: the worker only announces a purge, this thread applies it on its own connection
    if (notice.commit.kind === 'blob_purge') return replica.purgeBlobs(notice.commit.ids);
    const part = notice.part;
    // after a divergence the rest of that page is discarded: the re-read already holds the whole page
    if (discarding && part && part.index > 0) {
      if (part.index === part.count - 1) discarding = false;
      return;
    }
    discarding = false;
    if (replica.applyNotice(notice)) return;
    discarding = part !== undefined && part.index < part.count - 1;
    fault(
      new HostProtocolError(
        'replica_diverged',
        'a change did not start at the replica cursor; re-reading the database',
      ),
    );
    await replica.rehydrate();
  }

  function handle(m: FromWorker, fed: boolean): Promise<void> | void {
    switch (m.kind) {
      case 'ready':
        if (fed) return;
        onReady?.(m.cursor);
        return;
      case 'change':
        return apply(m.notice);
      case 'status':
        status = m.status;
        for (const l of [...statusListeners]) l(status);
        return;
      case 'pulled': {
        if (fed) return;
        const p = pulls.get(m.id);
        if (!p) return fault(new HostProtocolError('out_of_order', `pulled ${m.id} answers no pull`));
        pulls.delete(m.id);
        if (m.result) p.resolve(m.result);
        else p.reject(fromWire(m.error as NonNullable<typeof m.error>));
        return;
      }
      case 'rederive':
        // a follower has no worker to answer; the holder's tab answers its own worker
        if (fed) void o.predictions.rederive(m.reason as SyncResetReason).catch(fault);
        else
          o.predictions.rederive(m.reason as SyncResetReason).then(
            () => post({ kind: 'rederived', id: m.id }),
            (e: unknown) => post({ kind: 'rederived', id: m.id, error: toWire(e) }),
          );
        return;
      case 'versions':
        if (!o.versions) return;
        if (m.completed) void o.versions.synced(m.versions).catch(fault);
        else o.versions.follow(m.versions);
        return;
      case 'issue':
        if (fed) return;
        replica.markUnavailable();
        o.options.onIssue?.(m.issue);
        return;
      default:
        if (fed) return;
        return fault(new Error(`the sync worker failed: ${m.message}`));
    }
  }

  // Messages are handled one at a time and in order; only a rehydrate is asynchronous. Idle, a notice is
  // applied inside the message task itself.
  const inbox: { data: unknown; fed: boolean }[] = [];
  let draining = false;
  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (inbox.length) {
        try {
          const next = inbox.shift() as { data: unknown; fed: boolean };
          const m = parseFromWorker(next.data);
          // the holder hands its worker's messages on to the followers, in order
          if (
            !next.fed &&
            tabs?.isHolder() &&
            m.kind !== 'ready' &&
            m.kind !== 'pulled' &&
            m.kind !== 'issue'
          )
            tabs.relay(next.data);
          const r = handle(m, next.fed);
          if (r) await r;
        } catch (e) {
          fault(e instanceof Error ? e : new Error(String(e)));
        }
      }
    } finally {
      draining = false;
    }
  }
  port.onmessage = (event) => {
    inbox.push({ data: event.data, fed: false });
    void drain();
  };
  port.onerror = (event) =>
    fault(
      new Error(`the sync worker crashed: ${String((event as { message?: unknown })?.message ?? event)}`),
    );

  async function startWorker(): Promise<void> {
    discarding = false;
    const ready = new Promise<CommitNotice['from']>((resolve) => (onReady = resolve));
    post({ kind: 'init', name: o.name, config: o.config });
    const cursor = await ready;
    // the replica was hydrated before the worker opened (or, after a takeover, it followed the old holder);
    // if the database moved in between, read it again
    if (!sameCursor(cursor, replica.cursor())) await replica.rehydrate();
    post({ kind: 'start' });
  }
  const pullLocal = () =>
    new Promise<PullResult>((resolve, reject) => {
      if (disposed) return reject(new Error('the sync host was disposed'));
      const id = nextPull++;
      pulls.set(id, { resolve, reject });
      post({ kind: 'pull', id });
    });

  if (o.tabs === SINGLE_TAB) await startWorker();
  else {
    tabs = openTabs(o.tabs, o.name, {
      startWorker,
      pullLocal,
      feed: (data) => {
        inbox.push({ data, fed: true });
        void drain();
      },
      fault,
    });
    await tabs.begin();
  }

  return {
    store: replica,
    sync: {
      pull: () => (tabs ? tabs.pull() : pullLocal()),
      status: () => status,
      subscribe(listener) {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      tabs?.close();
      if (!tabs || tabs.isHolder()) post({ kind: 'close' });
      rejectPulls(new Error('the sync host was disposed'));
      replica.close();
      o.onDispose?.();
    },
  };
}
