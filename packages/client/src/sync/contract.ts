/**
 * Sync worker contract (docs/07-sync-and-offline.md, WP-512). CONTRACT: changes need the lead.
 *
 * - One engine pulls snapshot and delta pages of the `core/sync` protocol and applies each page with the
 *   cursor in ONE store transaction (`DeviceStore.applyPage`). A crash resumes at the stored cursor.
 * - HTTP, the doorbell, timers and page-visibility events are ports. The worker owns no I/O.
 * - No telemetry travels through here (H5). Nothing assumes one scope per device (H4): the scope fingerprint
 *   is whatever the server reports, and a change of it re-snapshots.
 * - Predictions are never touched by a pull; only a reset asks the run queue to re-derive them.
 * - A snapshot is paged with `after` and pinned with `pin` (core/sync `SyncRequest`); the pinned head comes
 *   back as `header.head`. The store cursor holds one number, so `SyncMeta` keeps the head while it runs.
 */
import type { Instant, Seq } from '@ueberblick/core/model';
import type { SyncPage, SyncRequest } from '@ueberblick/core/sync';
import type { DeviceStore } from '../store';
import type { VersionsSink } from '../config';
import type { SyncFailureKind, SyncPhase, SyncResetReason, SyncTrigger } from '@ueberblick/core/registry';

/** The HTTP port. Throws `SyncProtocolError` for typed protocol failures, anything else counts as transient. */
export interface SyncTransport {
  fetchPage(request: SyncRequest): Promise<SyncPage>;
}

/** The snapshot head, kept next to the store cursor (which holds one number). */
export interface SyncState {
  readonly head: Seq;
}

export interface SyncMeta {
  read(): Promise<SyncState | undefined>;
  write(state: SyncState): Promise<void>;
  clear(): Promise<void>;
  /** When the last pull completed on this device (WP-678); survives a restart. `undefined`: never synced. */
  readLastSynced(): Promise<Instant | undefined>;
  /** `undefined` forgets it (the local copy was dropped). */
  writeLastSynced(at: Instant | undefined): Promise<void>;
}

/** The run queue re-derives predictions from its queued runs after the local copy was rebuilt. */
export interface PredictionRefresher {
  rederive(reason: SyncResetReason): Promise<void>;
}

export interface SyncFailure {
  readonly kind: SyncFailureKind;
  /** The typed core/sync or store code, when there is one. */
  readonly code: string | undefined;
  readonly message: string;
}

export interface SyncStatus {
  readonly phase: SyncPhase;
  /** Set once a pull reached the end of the server's data; `undefined` before the first sync. */
  readonly lastSyncedAt: Instant | undefined;
  /** The seq the store is current up to. */
  readonly lastSyncedSeq: Seq | undefined;
  readonly lastError: SyncFailure | undefined;
  /** Snapshot progress: features written since the snapshot began. */
  readonly featuresLoaded: number;
}

export interface PullResult {
  readonly pages: number;
  readonly reset: SyncResetReason | undefined;
  readonly cursor: Seq;
  /** True when a page's `header.access` differed from the last one seen (WP-793): the device re-reads its roles. */
  readonly accessChanged?: boolean;
  /** The last `header.access` seen, absent when the server sent none (WP-798): the app compares it with the bootstrap's. */
  readonly access?: string;
}

/** The worker the host runs: `restore` loads the persisted `lastSyncedAt` into the status once, at start. */
export interface SyncEngine extends SyncWorker {
  restore(): Promise<void>;
}

export interface SyncWorker {
  /** Single-flight: a call during a pull waits for it and then pulls once more. Rejects with the typed error. */
  pull(): Promise<PullResult>;
  status(): SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
}

export interface SyncWorkerDeps {
  readonly store: DeviceStore;
  readonly transport: SyncTransport;
  readonly meta: SyncMeta;
  readonly predictions: PredictionRefresher;
  readonly clock: { now(): Instant };
  /**
   * Tells the device about config versions (WP-669, A-029 item 4): each page header's `versions`, and a completed
   * pull. The sink decides what to keep; a failed pull never calls `synced`, so nothing is pruned offline.
   */
  readonly config?: VersionsSink;
}

/** Timer port so tests control the debounce. */
export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Something that emits without payload (SSE doorbell, `online`, `visibilitychange`). */
export interface Signal {
  subscribe(onSignal: () => void): () => void;
}

/** An `event: tool` doorbell: rings with the tool key and nothing else (H5, B-020). */
export interface KeyedSignal {
  subscribe(onRing: (toolKey: string) => void): () => void;
}

/** The tool streams' share of auto sync (`ctx.data`, WP-683): `createToolData` implements it. */
export interface ToolSync {
  readonly doorbell: KeyedSignal;
  /** Pulls one tool's stream (only if the person's roles offer the tool). */
  pull(toolKey: string): Promise<unknown>;
  /** Everything the device owes the streams: outbox, read marks, then a pull of every available tool. */
  sync(): Promise<unknown>;
}

export interface AutoSyncDeps {
  readonly worker: SyncWorker;
  readonly timers: Timers;
  readonly doorbell: Signal;
  readonly online: Signal;
  readonly visible: Signal;
  /** Tool streams: synced on open, `online` and `visible`; a tool doorbell pulls that tool after the debounce. */
  readonly tools?: ToolSync;
  /** Doorbell debounce; default `DOORBELL_DEBOUNCE_MS`. */
  readonly debounceMs?: number;
  readonly onError?: (trigger: SyncTrigger, error: unknown) => void;
}

export const DOORBELL_DEBOUNCE_MS = 500;
