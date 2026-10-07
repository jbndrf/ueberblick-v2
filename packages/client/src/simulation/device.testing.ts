/**
 * One simulated device built from the real adapters: an IndexedDB store on fake-indexeddb, the run queue and
 * the sync worker. Its only connection to the server is a transport that passes through the seeded faults.
 * A restart closes the store and reopens the same database (queue and cursor survive, in-flight state does not).
 */
import type { MemoryStore } from '@ueberblick/core/memory';
import type { Actor, Run } from '@ueberblick/core/model';
import type { Ids } from '@ueberblick/core/ports';
import type { FakeClock, RunDraft } from '@ueberblick/core/testing';
import { createRunQueue, noLock } from '../queue';
import type { EnqueueResult, RunQueue, RunTransport } from '../queue';
import type { DeviceStore, IdbEnv } from '../store';
import { openDeviceStore } from '../store/open';
import { fakeEnv, memoryMarker } from '../store/test-env';
import { createSyncWorker, decodingTransport, inlineDecoder } from '../sync';
import type { EncodedSyncTransport, SyncMeta, SyncWorker } from '../sync';
import { memoryMeta } from '../sync/test-server';
import type { SimBackend } from './contract.testing';
import { dumpStore, type StoreDump } from './dump.testing';
import { pruneFinishedTransactions } from './fake-idb.testing';
import { NetworkFault, type Faults, type Link } from './net.testing';

/** Each queue drain moves the monotonic clock past any backoff (at most `DEFAULT_BACKOFF.capMs`). */
const MONO_STEP = 1_000_000;

export interface DeviceKit {
  readonly index: number;
  readonly actor: Actor;
  readonly backend: SimBackend;
  readonly clock: FakeClock;
  readonly faults: Faults;
  /** Persistent across restarts: a restarted device must not mint an id it used before. */
  readonly ids: Ids;
  /** Feature rows per page this device asks for (small, so snapshots and deltas take several pages). */
  readonly maxRows: number;
}

export class RealDevice {
  readonly link: Link = { online: true };
  /** Every run this device tried, refused on the device or not. */
  readonly submitted: Run[] = [];
  restarts = 0;
  store!: DeviceStore;
  queue!: RunQueue;
  worker!: SyncWorker;
  private readonly env: IdbEnv = fakeEnv();
  private readonly marker = memoryMarker();
  private meta: SyncMeta = memoryMeta();
  private mono = MONO_STEP;
  private readonly runs: RunTransport;
  private readonly encoded: EncodedSyncTransport;

  private constructor(private readonly kit: DeviceKit) {
    const run = kit.backend.runTransport(kit.actor);
    const sync = kit.backend.syncTransport(kit.actor);
    this.runs = { send: (payload) => kit.faults.call(this.link, () => run.send(payload), true) };
    this.encoded = {
      fetchEncoded: (request) => kit.faults.call(this.link, () => sync.fetchEncoded(request), false),
    };
  }

  static async open(kit: DeviceKit): Promise<RealDevice> {
    const d = new RealDevice(kit);
    await d.boot();
    return d;
  }

  get index(): number {
    return this.kit.index;
  }

  get actor(): Actor {
    return this.kit.actor;
  }

  /** `Workload.nextRun` reads `ids(type)` of what the device predicts; the device store answers the same question. */
  get view(): MemoryStore {
    return { ids: (type: string) => this.store.featureIdsOfType(type) } as unknown as MemoryStore;
  }

  private async boot(): Promise<void> {
    const { backend, clock, ids, maxRows } = this.kit;
    this.store = await openDeviceStore(`device-${this.kit.index}`, { env: this.env, marker: this.marker });
    this.queue = await createRunQueue({
      store: this.store,
      config: { get: (v) => (v === 1 ? backend.config : 'refetching') },
      transport: this.runs,
      blobTransport: { has: async () => true, put: async () => 'ok' }, // simulated runs carry no files
      lock: noLock,
      clock,
      ids,
      mono: () => this.mono,
      timers: { set: () => 0, clear: () => undefined },
      onError: (e) => {
        throw e; // a simulated device never swallows a queue fault
      },
    });
    this.worker = createSyncWorker({
      store: this.store,
      transport: decodingTransport(this.encoded, inlineDecoder, maxRows),
      meta: this.meta,
      predictions: this.queue,
      clock,
    });
  }

  /** Closes and reopens the database. `dropMeta` also loses the snapshot head (a crash mid-snapshot restarts it). */
  async restart(dropMeta: boolean): Promise<void> {
    this.restarts++;
    this.store.close();
    if (dropMeta) this.meta = memoryMeta();
    await this.boot();
  }

  private draftToRun(draft: RunDraft): Run {
    const { ids, clock } = this.kit;
    return { ...draft, id: ids.runId(), configVersion: 1, clientTime: clock.now() };
  }

  /** The user starts a run: planned against the predicted state, stored, queued. A refusal stays a visible draft. */
  async create(draft: RunDraft): Promise<EnqueueResult> {
    const run = this.draftToRun(draft);
    this.submitted.push(run);
    return this.queue.enqueue(run);
  }

  /** An atomic batch (H2): the drafts run as this device's actor. */
  async createBatch(drafts: readonly RunDraft[]): Promise<EnqueueResult | undefined> {
    if (drafts.length === 0) return undefined;
    const runs = drafts.map((d) => this.draftToRun({ ...d, actor: this.kit.actor }));
    this.submitted.push(...runs);
    return this.queue.submit(runs);
  }

  /** A new tick: the queue may try again (a backoff is never longer than one tick of monotonic time). */
  async drain(): Promise<void> {
    this.mono += MONO_STEP;
    pruneFinishedTransactions(this.env.factory);
    if (!this.link.online) return;
    await this.queue.drain();
  }

  /** Pulls to the end of the server's data and tells the queue how far it got. False when the wire failed. */
  async pull(): Promise<boolean> {
    try {
      const r = await this.worker.pull();
      await this.queue.onPulled(r.cursor);
      return true;
    } catch (e) {
      if (e instanceof NetworkFault) return false;
      throw e;
    }
  }

  /** Runs sent and answered, or still to send. Zero means the device has nothing left to do. */
  livePending(): number {
    return this.queue.status().pending + this.queue.status().awaitingPull;
  }

  cursor(): number | undefined {
    return this.store.cursor()?.cursor;
  }

  dump(): StoreDump {
    return dumpStore(this.store, this.kit.backend.config);
  }

  /** Ends backoffs, as `online` and focus do in the app. */
  reconnect(): void {
    this.queue.resetBackoff();
  }
}
