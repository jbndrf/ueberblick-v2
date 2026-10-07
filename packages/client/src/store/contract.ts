/**
 * Device store contract (docs/07-sync-and-offline.md "Device storage", WP-510). CONTRACT: changes need the lead.
 *
 * - `Facts` and `Blobs` (core ports) are synchronous, IndexedDB is not. The store therefore keeps
 *   features, edges and the blob-key set in memory, hydrated once at open, and updates them only after
 *   the IndexedDB transaction committed. History is loaded on demand: call `warmHistory(ids)` before
 *   `facts.history(...)` (which throws `history_not_warm` otherwise, never a silent empty answer).
 * - Server rows are already folded states. `core.fold` produces the predicted states passed to
 *   `putPrediction`; predictions overlay the server state until dropped.
 * - The store is per participant and per project (H4): `openDeviceStore(name)` names one database.
 * - Geometry (with Z) lives inside `properties` and is stored unchanged (H1).
 * - The store never deletes the database. It never writes outside its own database.
 */
import type { Blobs, Facts } from '@ueberblick/core/ports';
import type {
  Edge,
  FeatureId,
  FeatureState,
  Key,
  RecordedObservation,
  Refusal,
  Run,
  RunId,
  Seq,
} from '@ueberblick/core/model';
import type {
  SyncEdge,
  SyncObservation,
  SyncPageKind,
  SyncPerson,
  SyncRun,
  SyncTombstone,
} from '@ueberblick/core/sync';
import type { QueueRunState, StoreErrorCode, StoreOrigin } from '@ueberblick/core/registry';
import type { CompiledConfigData } from '@ueberblick/core/hydrate';
import type { IdbEnv } from './idb-types';

/** One searchable property of one feature type (a `tools.search.sources` entry `type.property`). */
export interface TextSource {
  readonly type: Key;
  readonly property: string;
}

/** Where the "this device was initialised" marker lives outside IndexedDB (localStorage in the app). */
export interface EvictionMarker {
  isInitialised(): boolean;
  markInitialised(): void;
}

export interface StoreIssue {
  readonly code: StoreErrorCode;
  readonly message: string;
}

export interface OpenOptions {
  readonly env: IdbEnv;
  readonly marker: EvictionMarker;
  /** Called for `blocked`, `terminated` and `version_change`. The database is never deleted. */
  readonly onIssue?: (issue: StoreIssue) => void;
}

/** The rows of one sync page the store persists (a `SyncPage` without its header fields). */
export interface PageRows {
  readonly features: readonly FeatureState[];
  readonly edges: readonly SyncEdge[];
  readonly observations: readonly SyncObservation[];
  readonly tombstones: readonly SyncTombstone[];
  /** The runs of the observations on the page; stored only while a history row references them. */
  readonly runs: readonly SyncRun[];
  readonly people: readonly SyncPerson[];
  /** Present when the page carries the choosable list (WP-725): the whole set, REPLACING the device's. */
  readonly choosable?: readonly { readonly id: string; readonly name: string }[];
}

/** Written in the same transaction as the page. `null` scope fingerprint = never synced. */
export interface StoredCursor {
  readonly kind: SyncPageKind;
  readonly cursor: Seq;
  readonly scopeFingerprint: string;
}

export interface PageOutcome {
  readonly featuresWritten: number;
  /** Rows dropped because the store already held the same or a newer `updatedSeq`. */
  readonly staleSkipped: number;
}

/** The states a run can be stored in (`sending` lives in memory only). */
export type StoredRunState = Exclude<QueueRunState, 'sending'>;

/** A run on the device. `order` is a device-monotonic counter, never a clock. */
export interface StoredRun {
  readonly order: number;
  readonly run: Run;
  /** sha256 of the upload blobs the run refers to. */
  readonly blobs: readonly string[];
  /** MIME type per blob sha256, kept with the row so an upload after a reload sends the right `Content-Type`. */
  readonly blobMimes: Readonly<Record<string, string>>;
  /** Absent in rows written before the run queue existed: read as `queued`. */
  readonly state: StoredRunState;
  /** Runs of one atomic batch (H2) share a group id; they are stored together and sent as one request. */
  readonly group?: string;
  readonly refusal?: Refusal;
  /** sha256 of the blobs already PUT to the server (WP-803): a retry skips them. Optional and additive. */
  readonly uploaded?: readonly string[];
  /** Last seq of the accepted run: the prediction can go once a pull reached it. */
  readonly acceptedSeq?: Seq;
}

/** One run to store, with its upload blobs. */
export interface RunEntryInput {
  readonly run: Run;
  readonly blobs?: readonly BlobInput[];
}

/** How `appendRuns` stores its entries; the default is `queued`. A refused draft keeps the input the user typed. */
export interface AppendRunsOptions {
  readonly group?: string;
  readonly state?: StoredRunState;
  readonly refusal?: Refusal;
}

/** A new state for one stored run. */
export interface RunSettlement {
  readonly runId: RunId;
  readonly state: StoredRunState;
  readonly refusal?: Refusal;
  readonly acceptedSeq?: Seq;
  /** When given, replaces the run's uploaded blob list (WP-803); absent keeps it. */
  readonly uploaded?: readonly string[];
}

export interface BlobInput {
  readonly sha256: string;
  readonly bytes: Uint8Array;
  /** MIME type of the bytes: what the upload sends as `Content-Type`. */
  readonly mime: string;
}

/** One value the plan wrote: all that Aktivität needs of a planned observation. */
export interface PlannedChange {
  readonly featureId: FeatureId;
  readonly property: string;
  readonly result: unknown;
}

/** Predicted state of one queued run, layered over the server state (`core.fold` output). */
export interface Prediction {
  readonly runId: RunId;
  /** What the run's plan wrote, in plan order, rule runs it caused included (WP-854: Aktivität shows a waiting run as planned). */
  readonly observations: readonly PlannedChange[];
  readonly features: readonly FeatureState[];
  readonly edges: readonly Edge[];
}

/** A compiled config version as stored: the raw JSON, whatever its `format` (readability is `hydrate`'s call). */
export interface StoredConfigVersion {
  readonly version: number;
  readonly data: CompiledConfigData;
}

/**
 * What changed on the device copy, told once per committed change (B-012). `page`: one applied sync page
 * (ids of the features written or removed, and the cursor now stored). Listeners run after the store's own
 * reads see the change. `reloaded`: a read replica re-read the whole database (it had diverged).
 */
export type StoreChange =
  | { readonly kind: 'page'; readonly featureIds: readonly FeatureId[]; readonly cursor: StoredCursor }
  | { readonly kind: 'cleared' }
  | {
      readonly kind: 'history_dropped';
      readonly featureId: FeatureId;
      readonly properties: readonly string[];
    }
  | { readonly kind: 'blob_deleted'; readonly sha256: string }
  | { readonly kind: 'reloaded' };

export interface DeviceStore {
  readonly origin: StoreOrigin;
  /** `open` until the connection is lost; then only `exportRuns` works. */
  readonly state: 'open' | 'unavailable';
  readonly facts: Facts;
  readonly blobs: Blobs;

  /** Reads through the in-memory index. */
  featureIdsOfType(type: string): readonly FeatureId[];
  /** Registers a property for `searchText` and bulk-builds its index from the features held (idempotent, in memory only). Call it at open or config load for every `tools.search.sources` entry. */
  indexText(type: Key, property: string): void;
  /**
   * Feature ids (at most `limit`) whose searched values contain every word of `query` as a prefix, case and
   * diacritics folded. Answers from the index, never a scan. A pure read: a later API may reuse it (H4).
   * Throws `DeviceStoreError` `text_source_not_indexed` for a source `indexText` never registered.
   * Includes features created by queued runs; excludes deleted ones.
   */
  searchText(sources: readonly TextSource[], query: string, limit: number): readonly FeatureId[];
  cursor(): StoredCursor | undefined;
  /**
   * One call per committed change, whichever thread wrote it (B-012). Returns
   * the unsubscribe function.
   */
  onChange(listener: (change: StoreChange) => void): () => void;
  /**
   * True while the mirror is not a whole state: a page is half applied (a replica gets big pages in slices, each in its own task), or the replica is re-reading the database (features may be loaded before the cursor is). The run
   * queue does not consult it (it re-predicts via `rederive` after the whole pull); it is a hook for other readers (UI, map, facts) that must tolerate a half-applied page. Always false in-thread.
   */
  pageInFlight(): boolean;
  /** Loads the capped history of these features so `facts.history` can answer. Bounded cache. */
  warmHistory(ids: readonly FeatureId[]): Promise<void>;
  /** `warmHistory` plus the run rows of that history, so `observationsOf` and `runMeta` can answer (the Aktivität timeline). */
  warmActivity(id: FeatureId): Promise<void>;
  /** True when the history of this feature is loaded (`warmHistory`, `warmActivity`). */
  activityWarm(id: FeatureId): boolean;
  /** All warm history of a feature, newest seq first (<= 10 per property). Throws `history_not_warm` when cold. */
  observationsOf(id: FeatureId): readonly RecordedObservation[];
  /** The run row of a synced run; undefined when unknown on this device or not warmed (`warmActivity`). */
  runMeta(runId: RunId): SyncRun | undefined;
  /** The name the sync shipped for an actor id (clipped by the server: absent when the role may not see names). */
  personName(id: string): string | undefined;
  /** The participants this device may choose for a participant property, by name (WP-725); empty when the role may not. */
  choosableParticipants(): readonly { readonly id: string; readonly name: string }[];
  /** The `choosableHash` of that set: what the sync request tells the server the device holds (`''`: none). */
  choosableHash(): string;
  /** The queued runs on the device that name this feature or whose prediction touches it, oldest first (all states). */
  queuedRunsOf(id: FeatureId): readonly StoredRun[];
  /** What the plan of a queued run wrote to one feature, in plan order; empty when the run has no prediction. */
  plannedChangesOf(runId: RunId, id: FeatureId): readonly PlannedChange[];

  /** ONE transaction: page rows and cursor commit together or not at all. */
  applyPage(rows: PageRows, cursor: StoredCursor): Promise<PageOutcome>;
  /** Run and its blobs in one transaction. A repeated run id returns the existing order. */
  appendRun(run: Run, blobs?: readonly BlobInput[]): Promise<number>;
  /**
   * ALL entries and their blobs in ONE transaction (an atomic batch is never stored half): returns the orders,
   * in entry order. Repeated run ids keep their existing order and row. `quota_exceeded` writes nothing.
   */
  appendRuns(entries: readonly RunEntryInput[], options?: AppendRunsOptions): Promise<readonly number[]>;
  /** Changes the state of stored runs in ONE transaction. An unknown run id is skipped. */
  settleRuns(settlements: readonly RunSettlement[]): Promise<void>;
  /** Removes run rows (never their blobs) in ONE transaction: for discarded drafts and reconciled runs. */
  removeRuns(runIds: readonly RunId[]): Promise<void>;
  readRuns(): Promise<readonly StoredRun[]>;
  getBlob(sha256: string): Promise<Uint8Array | undefined>;
  putPrediction(prediction: Prediction): Promise<void>;
  dropPrediction(runId: RunId): Promise<void>;

  /** Purge tombstone `blob`: drops the bytes and the key of one blob, unless a stored run still references it. Idempotent. */
  deleteBlob(sha256: string): Promise<void>;
  /** Purge tombstone `redaction`: drops the cached history of these properties of one feature. Idempotent. */
  dropHistory(featureId: FeatureId, properties: readonly string[]): Promise<void>;
  /** Drops features, edges, history and the cursor. Never runs, blobs or predictions. */
  clearCache(): Promise<void>;
  /** After the app handled an `evicted` open (re-snapshot started). */
  acknowledgeEviction(): Promise<void>;
  /** Compiled config versions the device holds, for queued runs. Never dropped by `clearCache`. */
  putConfigVersion(version: number, data: CompiledConfigData): Promise<void>;
  readConfigVersions(): Promise<readonly StoredConfigVersion[]>;
  /** Drops one stored config version (WP-669: neither live nor referenced by a queued run). Idempotent. */
  deleteConfigVersion(version: number): Promise<void>;
  /** Runs for a queue export; also works when the store is `unavailable`. */
  exportRuns(): Promise<readonly StoredRun[]>;
  close(): void;
}

export interface OpenDeviceStore {
  (name: string, options: OpenOptions): Promise<DeviceStore>;
}

/** Ports for storage health (browser: navigator.storage, matchMedia). */
export interface StoragePort {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
  estimate(): Promise<{ readonly usage: number; readonly quota: number } | undefined>;
  isStandalone(): boolean;
}

/** Feeds the honest-state header (docs/13). `undefined` = the browser does not tell. */
export interface StorageHealth {
  readonly persisted: boolean;
  readonly usageBytes: number | undefined;
  readonly quotaBytes: number | undefined;
  /** Installed PWA: exempt from Safari's 7-day eviction. */
  readonly standalone: boolean;
  /** true when the store is at risk: not persisted and not standalone. */
  readonly atRisk: boolean;
}
