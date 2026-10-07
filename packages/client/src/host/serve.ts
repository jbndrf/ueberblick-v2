/**
 * The worker side of the sync host (B-012). Runs inside the dedicated worker: opens its own connection to the
 * device database as the writer, runs the one sync engine unchanged, and tells the main thread what it
 * committed. It owns every cache write; the main thread only mirrors them.
 */
import type { Instant } from '@ueberblick/core/model';
import type { SyncResetReason } from '@ueberblick/core/registry';
import { openCacheWriterStore } from '../store/open';
import { sliceNotice } from '../store/commit';
import type { DeviceStoreImpl } from '../store/store';
import type { IdbEnv } from '../store/idb-types';
import type { MessagePortLike } from '../sync/decode';
import type { PredictionRefresher, SyncEngine, SyncMeta, SyncTransport } from '../sync/contract';
import { idbSyncMeta } from '../sync/idb-meta';
import { createSyncWorker } from '../sync/worker';
import {
  HOST_PROTOCOL_VERSION,
  HostProtocolError,
  fromWire,
  parseToWorker,
  toWire,
  type Body,
  type FromWorker,
  type ToWorker,
} from './protocol';

/** What the worker needs from its host page's build: real adapters in the app, fakes in tests. Functions cannot be posted, so it is a factory. */
export interface WorkerSideDeps {
  readonly env: IdbEnv;
  readonly transport: SyncTransport;
  readonly clock: { now(): Instant };
  /** Default: the `syncHead` key of the device database. */
  readonly meta?: SyncMeta;
}

export type WorkerSideFactory = (init: Extract<ToWorker, { kind: 'init' }>) => WorkerSideDeps;

export interface ServedHost {
  /** The writer store once `init` opened it (tests read it; the app never does). */
  writer(): DeviceStoreImpl | undefined;
}

const STAGES = ['new', 'ready', 'started', 'closed'] as const;
type Stage = (typeof STAGES)[number];

export function serveSyncHost(port: MessagePortLike, factory: WorkerSideFactory): ServedHost {
  let stage: Stage = STAGES[0];
  let store: DeviceStoreImpl | undefined;
  let engine: SyncEngine | undefined;
  let nextRederive = 1;
  const rederiving = new Map<number, { resolve: () => void; reject: (e: unknown) => void }>();

  const post = (m: Body<FromWorker>) => port.postMessage({ v: HOST_PROTOCOL_VERSION, ...m });

  const predictions: PredictionRefresher = {
    rederive: (reason: SyncResetReason) =>
      new Promise<void>((resolve, reject) => {
        const id = nextRederive++;
        rederiving.set(id, { resolve, reject });
        post({ kind: 'rederive', id, reason });
      }),
  };

  const expect = (want: Stage, what: string) => {
    if (stage !== want)
      throw new HostProtocolError('out_of_order', `${what} arrived while the host was ${stage}`);
  };

  async function handle(m: ToWorker): Promise<void> {
    if (m.kind === 'init') {
      expect('new', 'init');
      const deps = factory(m);
      const opened = await openCacheWriterStore(m.name, {
        env: deps.env,
        marker: { isInitialised: () => true, markInitialised: () => undefined },
        onIssue: (issue) => post({ kind: 'issue', issue }),
      });
      store = opened;
      opened.onCommit((notice) => {
        for (const slice of sliceNotice(notice)) post({ kind: 'change', notice: slice });
      });
      engine = createSyncWorker({
        store: opened,
        transport: deps.transport,
        meta: deps.meta ?? idbSyncMeta(opened),
        predictions,
        clock: deps.clock,
        // the versions live on the main thread: forwarded, applied there (WP-669)
        config: {
          follow: (versions) => post({ kind: 'versions', versions, completed: false }),
          synced: (versions) => Promise.resolve(post({ kind: 'versions', versions, completed: true })),
        },
      });
      engine.subscribe((status) => post({ kind: 'status', status }));
      await engine.restore(); // the persisted last sync reaches the main thread before `ready`
      stage = 'ready';
      post({ kind: 'ready', cursor: opened.cursor() });
    } else if (m.kind === 'start') {
      expect('ready', 'start');
      stage = 'started';
    } else if (m.kind === 'pull') {
      expect('started', 'pull');
      const id = m.id;
      (engine as SyncEngine).pull().then(
        (result) => post({ kind: 'pulled', id, result }),
        (error: unknown) => post({ kind: 'pulled', id, error: toWire(error) }),
      );
    } else if (m.kind === 'rederived') {
      const w = rederiving.get(m.id);
      if (!w) throw new HostProtocolError('out_of_order', `rederived ${m.id} answers no request`);
      rederiving.delete(m.id);
      if (m.error) w.reject(fromWire(m.error));
      else w.resolve();
    } else {
      stage = 'closed';
      store?.close();
    }
  }

  port.onmessage = (event) => {
    let message: ToWorker;
    try {
      message = parseToWorker(event.data);
    } catch (e) {
      post({ kind: 'fault', message: e instanceof Error ? e.message : String(e) });
      return;
    }
    handle(message).catch((e: unknown) =>
      post({ kind: 'fault', message: e instanceof Error ? e.message : String(e) }),
    );
  };

  return { writer: () => store };
}
