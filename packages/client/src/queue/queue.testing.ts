/** Test helpers for the run queue: a seeded device store, a fake run server with a ledger, fake ports. Tests only. */
import { createClock, createIds } from '@ueberblick/core/testing';
import type { Actor, FeatureId, Instant, Json, Key, Refusal, Run, RunId } from '@ueberblick/core/model';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import { musterstadt, IDS, anna as annaActor } from './world.testing';
import type { World } from './world.testing';
import { openDeviceStore } from '../store/open';
import type { DeviceStore, IdbEnv } from '../store';
import { fakeEnv, memoryMarker } from '../store/test-env';
import type { Timers } from '../sync';
import type {
  BatchResponse,
  BlobPutResult,
  BlobTransport,
  QueueLock,
  RunPayload,
  RunQueueDeps,
  RunReply,
  RunResponse,
  RunTransport,
  RunWire,
} from './contract';
import { createRunQueue } from './queue';
import { deviceClone } from '../testing/clone.testing';

export { IDS };
export const anna: Actor = annaActor;
export const NOW = '2026-05-01T08:00:00.000Z' as Instant;

export const runId = (n: number): RunId => `20000000-0000-7000-8000-${String(n).padStart(12, '0')}` as RunId;

export const kontrolle = (
  n: number,
  featureId: FeatureId,
  befund: string,
  extra: Partial<Run> = {},
): Run => ({
  id: runId(n),
  task: 'kontrolle' as Key,
  actor: anna,
  configVersion: 1,
  featureId,
  input: { vitalitaet: 'v1', befund },
  ...extra,
});

export const befundErgaenzen = (n: number, featureId: FeatureId, befund: string): Run => ({
  id: runId(n),
  task: 'befund_ergaenzen' as Key,
  actor: anna,
  configVersion: 1,
  featureId,
  input: { befund },
});

/** Copies the world's folded features and edges into the device store as one snapshot page. */
export async function seed(store: DeviceStore, world: World): Promise<void> {
  const features = [...world.features.values()].map((f) => ({
    id: f.id,
    type: f.type,
    properties: f.properties,
    lifecycle: f.lifecycle,
    updatedSeq: f.updatedSeq,
  }));
  const edges = [...world.edges.values()].map((e) => ({ ...e, updatedSeq: 1 }));
  await store.applyPage(
    { features, edges, observations: [], tombstones: [], runs: [], people: [] },
    { kind: 'delta', cursor: 1, scopeFingerprint: 'scope-a' },
  );
}

export interface ServerScript {
  /** Called before a run is judged; return a refusal to refuse it, or undefined. */
  readonly refuse?: (run: RunWire) => Refusal | undefined;
}

/** A fake run server with a ledger: a repeated run id answers the stored result and applies nothing twice. */
export class FakeRunServer implements RunTransport {
  readonly sent: RunPayload[] = [];
  readonly applied = new Map<string, number>();
  readonly ledger = new Map<string, RunResponse>();
  script: ServerScript = {};
  /** When set, `send` answers with it (network, 401, ...) instead of judging. */
  next: (() => Promise<RunReply>) | undefined;
  private seq = 1;
  inFlight = 0;
  maxInFlight = 0;
  /** Awaited before each answer: tests hold it to keep a request in flight. */
  gate: Promise<void> | undefined;

  judge(run: RunWire): RunResponse {
    const known = this.ledger.get(run.id);
    if (known) return known;
    const refusal = this.script.refuse?.(run);
    const res: RunResponse = refusal
      ? { outcome: 'refused', runId: run.id, refusal }
      : { outcome: 'accepted', runId: run.id, seq: { from: this.seq, to: this.seq++ } };
    if (res.outcome === 'accepted') this.applied.set(run.id, (this.applied.get(run.id) ?? 0) + 1);
    this.ledger.set(run.id, res);
    return res;
  }

  async send(payload: RunPayload): Promise<RunReply> {
    this.sent.push(deviceClone(payload));
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.gate) await this.gate;
      if (this.next) return await this.next();
      if (payload.kind === 'run') return { kind: 'response', response: this.judge(payload.run) };
      const results: { runId: string; seq: { from: number; to: number } }[] = [];
      const first = this.seq;
      for (const [index, run] of payload.runs.entries()) {
        const refusal = this.script.refuse?.(run);
        if (refusal) {
          for (const r of results) this.applied.delete(r.runId);
          this.seq = first;
          const response: BatchResponse = { outcome: 'refused', index, runId: run.id, refusal };
          return { kind: 'response', response };
        }
        const one = this.judge(run);
        if (one.outcome === 'accepted') results.push({ runId: one.runId, seq: one.seq });
      }
      const response: BatchResponse = {
        outcome: 'accepted',
        results,
        seq: { from: first, to: this.seq - 1 },
      };
      return { kind: 'response', response };
    } finally {
      this.inFlight--;
    }
  }
}

/** A fake blob server: what it holds, the order of calls (shared with the run server's log), scripted answers. */
export class FakeBlobServer implements BlobTransport {
  readonly held = new Map<string, { bytes: Uint8Array; mime: string }>();
  /** Every call in order, `has:<sha>` / `put:<sha>`; pass the run server's log to prove upload-before-run order. */
  constructor(readonly log: string[] = []) {}
  /** When set, thrown by `has` and `put` (offline). */
  fail: Error | undefined;
  /** Answer of `put` instead of storing. */
  putResult: BlobPutResult | undefined;

  async has(sha256: string): Promise<boolean> {
    this.log.push(`has:${sha256}`);
    if (this.fail) throw this.fail;
    return this.held.has(sha256);
  }

  async put(sha256: string, bytes: Uint8Array, mime: string): Promise<BlobPutResult> {
    this.log.push(`put:${sha256}`);
    if (this.fail) throw this.fail;
    if (this.putResult && this.putResult !== 'ok') return this.putResult;
    this.held.set(sha256, deviceClone({ bytes, mime }));
    return 'ok';
  }
}

/** One holder at a time, like Web Locks with `ifAvailable`. Shared between two queues to model two tabs. */
export interface MemoryLock extends QueueLock {
  /** Pretend another tab already holds the lock (or stop), without going through `tryRun`. */
  setHeld(v: boolean): void;
}
export function memoryLock(): MemoryLock {
  let held = false;
  return {
    setHeld(v: boolean) {
      held = v;
    },
    async tryRun(fn) {
      if (held) return { ran: false };
      held = true;
      try {
        return { ran: true, value: await fn() };
      } finally {
        held = false;
      }
    },
  };
}

export interface FakeTimers extends Timers {
  readonly pending: { readonly fn: () => void; readonly ms: number }[];
  fire(): void;
}
export function fakeTimers(): FakeTimers {
  const pending: { fn: () => void; ms: number }[] = [];
  return {
    pending,
    set: (fn, ms) => {
      const t = { fn, ms };
      pending.push(t);
      return t;
    },
    clear: (h) => {
      const i = pending.indexOf(h as (typeof pending)[number]);
      if (i >= 0) pending.splice(i, 1);
    },
    fire() {
      for (const t of pending.splice(0)) t.fn();
    },
  };
}

export interface Kit {
  readonly store: DeviceStore;
  readonly env: IdbEnv;
  readonly server: FakeRunServer;
  readonly blobs: FakeBlobServer;
  readonly config: CompiledConfig;
  readonly world: World;
  readonly clock: ReturnType<typeof createClock>;
  readonly timers: FakeTimers;
  readonly mono: { t: number };
  /** What the queue reported through `onError`. */
  readonly errors: unknown[];
  readonly deps: RunQueueDeps;
  readonly queue: Awaited<ReturnType<typeof createRunQueue>>;
}

export interface KitOptions {
  readonly env?: IdbEnv;
  readonly server?: FakeRunServer;
  readonly blobs?: FakeBlobServer;
  readonly lock?: QueueLock;
  readonly config?: (v: number) => CompiledConfig | 'refetching';
  readonly store?: DeviceStore;
  readonly sendTimeoutMs?: number;
}

export async function makeKit(o: KitOptions = {}): Promise<Kit> {
  const { config, world } = musterstadt();
  const env = o.env ?? fakeEnv();
  const store = o.store ?? (await openDeviceStore('q', { env, marker: memoryMarker() }));
  if (!o.store) await seed(store, world);
  const server = o.server ?? new FakeRunServer();
  const blobs = o.blobs ?? new FakeBlobServer();
  const clock = createClock(NOW);
  const timers = fakeTimers();
  const mono = { t: 1_000 };
  const errors: unknown[] = [];
  const deps: RunQueueDeps = {
    store,
    config: { get: o.config ?? ((v: number) => (v === 1 ? config : 'refetching')) },
    transport: server,
    blobTransport: blobs,
    lock: o.lock ?? memoryLock(),
    clock,
    ids: createIds(7),
    mono: () => mono.t,
    timers,
    onError: (e) => errors.push(e),
    ...(o.sendTimeoutMs !== undefined ? { sendTimeoutMs: o.sendTimeoutMs } : {}),
  };
  const queue = await createRunQueue(deps);
  return { store, env, server, blobs, config, world, clock, timers, mono, errors, deps, queue };
}

export const refusal = (code: string, message = code): Refusal => ({ code, message });
export const inputOf = (r: Run): { readonly [k: string]: Json } => r.input;
