/**
 * Run queue contract (docs/07-sync-and-offline.md "Run queue", WP-511). CONTRACT: changes need the lead.
 *
 * - A run is stored before anything else happens (`DeviceStore.appendRuns`), predicted with `core.plan` and
 *   `core.fold` (`putPrediction`), and sent strictly one entry at a time in enqueue order. The order is the
 *   store's device counter; no clock is ever read for it (docs/07: order = server seq, clocks are metadata).
 * - An entry is one run, or the runs of one atomic batch (H2): stored in one transaction, sent as one request,
 *   refused as a whole. An assistant's confirmed runs (H4) enter through the same `submit`.
 * - In a `backoff` the queue schedules its own retry through `deps.timers` (one timer at most, cancelled by
 *   `resetBackoff`, a settled drain and `close`); `incompatible_protocol` and `auth_expired` never schedule one.
 * - Only a typed reply (`RunReply` kind `response`, built by `decodeRunReply` from a body that matches the run
 *   endpoint schema) settles a run. Timeouts, 5xx, offline and unknown 404 are `transient`: capped backoff,
 *   reset by `resetBackoff` (online, focus). A 401 pauses the queue (`auth_expired`); nothing is lost.
 * - The queue talks to the store only through `QueueStore`, all async except the `facts` port that
 *   `core.plan` needs (B-004), so the store may later run in a Web Worker (B-012).
 * - The refusal `code` comes from core's refusal registry and travels unchanged from plan (or the server) to
 *   `QueueStatus.refused`. The ui derives its text from the code, never from an HTTP status.
 */
import type { Ids, Clock } from '@ueberblick/core/ports';
import type { Geo } from '@ueberblick/core/geo';
import type { FeatureId, Refusal, Run, RunId, Seq } from '@ueberblick/core/model';
import type {
  BlobPutResult,
  QueueErrorCode,
  QueueHold,
  QueueRunState,
  SyncResetReason,
} from '@ueberblick/core/registry';
import type { ConfigVersions } from '../config';
import type { BlobInput, DeviceStore, StoredRun } from '../store';
import type { PredictionRefresher, Timers } from '../sync';

/** The slice of `DeviceStore` the queue uses (the config-versions module does the same). */
export type QueueStore = Pick<
  DeviceStore,
  | 'facts'
  | 'warmHistory'
  | 'appendRuns'
  | 'settleRuns'
  | 'removeRuns'
  | 'deleteBlob'
  | 'readRuns'
  | 'exportRuns'
  | 'getBlob'
  | 'putPrediction'
  | 'dropPrediction'
>;

/** A run as the run endpoints take it: no actor, no `causedBy` (`packages/server/src/http/runs/schema.ts`). */
export interface RunWire {
  readonly id: string;
  readonly task: string;
  readonly configVersion: number;
  readonly featureId?: string;
  readonly input: Run['input'];
  readonly clientTime?: string;
}

export type RunPayload =
  | { readonly kind: 'run'; readonly run: RunWire }
  | { readonly kind: 'batch'; readonly runs: readonly RunWire[] };

export interface SeqRange {
  readonly from: Seq;
  readonly to: Seq;
}

/** The typed answers of the run endpoints (structural mirror of the server's Zod schemas). */
export type RunResponse =
  | { readonly outcome: 'accepted'; readonly runId: string; readonly seq: SeqRange }
  | { readonly outcome: 'refused'; readonly runId: string; readonly refusal: Refusal }
  | {
      readonly outcome: 'review';
      readonly runId: string;
      readonly reason: 'config_version_gone';
      readonly configVersion: number;
    };

export type BatchResponse =
  | {
      readonly outcome: 'accepted';
      readonly results: readonly { readonly runId: string; readonly seq: SeqRange }[];
      readonly seq: SeqRange;
    }
  | {
      readonly outcome: 'refused';
      readonly index: number;
      readonly runId: string;
      readonly refusal: Refusal;
    }
  | {
      readonly outcome: 'review';
      readonly runId: string;
      readonly reason: 'config_version_gone';
      readonly configVersion: number;
    };

/** What the transport port answers. Anything that is not one of these is a thrown error and counts as transient. */
export type RunReply =
  | { readonly kind: 'response'; readonly response: RunResponse | BatchResponse }
  | { readonly kind: 'unauthenticated' }
  /** The reply names a protocol version this app does not speak: not a refusal, not transient. */
  | { readonly kind: 'incompatible'; readonly v: number | undefined }
  | { readonly kind: 'transient'; readonly reason: string };

/** The HTTP port. Build it with `decodeRunReply` so only a typed envelope can settle a run. */
export interface RunTransport {
  send(payload: RunPayload): Promise<RunReply>;
}

/** What `BlobTransport.put` answers when the server did not store the bytes. Network errors throw instead (transient). */
export type { BlobPutResult };

/**
 * The upload port (WP-605): before a run is sent, every file its row references is checked (`has`) and uploaded
 * (`put`) when missing, one at a time, so a run never references bytes the server lacks. A thrown error is
 * transient: the run is not sent and the queue backs off.
 */
export interface BlobTransport {
  has(sha256: string): Promise<boolean>;
  put(sha256: string, bytes: Uint8Array, mime: string): Promise<BlobPutResult>;
}

/** Single-flight across tabs (Web Locks in the app). `ran: false` means another holder has it. */
export interface QueueLock {
  tryRun<T>(
    fn: () => Promise<T>,
  ): Promise<{ readonly ran: true; readonly value: T } | { readonly ran: false }>;
}

export interface BackoffOptions {
  readonly baseMs: number;
  readonly capMs: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 2_000, capMs: 300_000 };
export const DEFAULT_SEND_TIMEOUT_MS = 30_000;

export interface RunQueueDeps {
  readonly store: QueueStore;
  readonly config: Pick<ConfigVersions, 'get'> & Partial<Pick<ConfigVersions, 'deployed'>>;
  readonly transport: RunTransport;
  readonly blobTransport: BlobTransport;
  readonly lock: QueueLock;
  /** Metadata only: stamps `clientTime` and the age in the status. Never orders anything. */
  readonly clock: Clock;
  /** Mints ids for features a rule creates and for resubmitted runs. */
  readonly ids: Ids;
  /** Monotonic milliseconds (`performance.now()`): backoff is measured with it, never with the wall clock. */
  readonly mono: () => number;
  readonly timers: Timers;
  readonly geo?: Geo;
  readonly backoff?: BackoffOptions;
  readonly sendTimeoutMs?: number;
  /** A retry the queue started by itself (after a backoff) threw: the app reports it. */
  readonly onError: (error: unknown) => void;
}

export interface RefusedRun {
  readonly runId: RunId;
  readonly task: string;
  readonly refusal: Refusal;
  /** The typed input, kept so it can be recovered (`exportQueue`, `resubmit`). */
  readonly input: Run['input'];
}

export interface ReviewRun {
  readonly runId: RunId;
  readonly task: string;
  readonly configVersion: number;
}

/** Feeds the header (docs/13): all synchronous, updated after every queue operation. */
export interface QueueStatus {
  /** Runs stored and not yet answered (queued or sending). */
  readonly pending: number;
  /** Runs accepted but not yet covered by a pull. */
  readonly awaitingPull: number;
  /** Age of the oldest pending run by the device clock (metadata; never negative). */
  readonly oldestPendingAgeMs: number | undefined;
  /** The head run while a request is in flight. */
  readonly sending: RunId | undefined;
  readonly refused: readonly RefusedRun[];
  readonly review: readonly ReviewRun[];
  readonly hold: QueueHold | undefined;
  /** Config versions the head run waits for. */
  readonly awaitingConfig: readonly number[];
  /** Milliseconds until the next attempt while in `backoff`. */
  readonly retryInMs: number | undefined;
  /** The protocol version the server answered with while `hold` is `incompatible_protocol`. */
  readonly serverProtocol: number | undefined;
  /** Runs with no prediction (config not readable yet, or a re-plan that failed): shown as "not previewed". */
  readonly unpredicted: readonly RunId[];
}

export type EnqueueResult =
  | {
      readonly ok: true;
      readonly orders: readonly number[];
      /**
       * What each submitted run created, by run id, read off its local plan (WP-681): the ids of the features whose
       * `$type` observation the plan holds. `[]` for a run that creates nothing; a feature only a rule created is not
       * listed. The ids are seeded from the run id, so they stay the same after a rebase or re-plan, and they are the
       * ones the server will give.
       */
      readonly created: Readonly<Record<RunId, readonly FeatureId[]>>;
    }
  | {
      readonly ok: false;
      /** The run that was refused on the device. Its input is stored as a refused draft. */
      readonly runId: RunId;
      readonly refusal: Refusal;
    };

export interface DrainResult {
  readonly accepted: number;
  readonly refused: number;
  readonly review: number;
  readonly hold: QueueHold | undefined;
  /** Another tab (or a call in this tab) holds the queue; nothing was sent here. */
  readonly busy: boolean;
}

/** Programming or precondition errors of the queue API. Refusals are values, never thrown. */
export class QueueError extends Error {
  constructor(
    readonly code: QueueErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QueueError';
  }
}

/** Upload blobs of a batch, keyed by run id. */
export type RunBlobs = Readonly<Record<string, readonly BlobInput[]>>;

export interface RunQueue extends PredictionRefresher {
  /** One run: `submit([run])`. */
  enqueue(run: Run, blobs?: readonly BlobInput[]): Promise<EnqueueResult>;
  /**
   * An atomic batch (H2): planned together, stored in one transaction, sent as one request. A device
   * refusal or a quota error stores nothing half: a refusal stores the whole batch as refused drafts,
   * `quota_exceeded` rejects and stores nothing.
   */
  submit(batch: readonly Run[], blobs?: RunBlobs): Promise<EnqueueResult>;
  /** Sends queued entries one at a time until one is not settled. Single-flight per tab and per lock. */
  drain(): Promise<DrainResult>;
  status(): QueueStatus;
  /**
   * The features the run created, from its latest plan (`[]` if it created none, was refused or is unknown). Kept
   * for the last 200 runs of this session, also after the run was accepted and pulled, so a form that submitted a
   * run can ask when the result is in.
   */
  createdBy(runId: RunId): readonly FeatureId[];
  subscribe(listener: (status: QueueStatus) => void): () => void;
  /** Ends a backoff and an `auth_expired` hold now: call on `online`, focus, sign-in and "Sync now". */
  resetBackoff(): void;
  /** Cancels the pending self-retry and schedules no more. Runs stay stored; `drain` still works when called. */
  close(): void;
  /** A pull reached `seq`: accepted runs it covers lose their prediction and leave the queue. */
  onPulled(seq: Seq): Promise<void>;
  /** Removes a refused, review or waiting (not yet sending) run, its batch and its parked bytes; a run being sent is `not_discardable`. */
  discard(runId: RunId): Promise<void>;
  /** Re-submits a refused draft (and its batch) under new run ids, then discards the old one. */
  resubmit(runId: RunId): Promise<EnqueueResult>;
  /** Every run on the device as JSON, with its state, also when the store is unavailable. */
  exportQueue(): Promise<string>;
  /** Re-derives every prediction from the stored runs (also called by `PredictionRefresher.rederive`). */
  rederive(reason: SyncResetReason): Promise<void>;
}

export type { StoredRun, QueueRunState };
