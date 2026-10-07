/**
 * Server store, write side (WP-104). CONTRACT: changes need the lead.
 *
 * `createStore(db, deps)` executes runs (docs/03 "life of a run"): ledger, plan, append runs and observations,
 * fold, edges (reference and derived, with tombstones for removals), hooks (outbox, timers), seq. One submitted
 * run, or one batch, is ONE transaction with ONE contiguous seq range (H2). It is the only write path (R3):
 * imports, admin edits, rules and OGC writes all arrive as runs through `submit` / `submitBatch`.
 *
 * - **Ledger.** `runs.id` is the idempotency key. A repeated id returns the stored `SubmitResult` unchanged and writes
 *   nothing (`runs.result`, migration 3). A refused run writes its `runs` row (`outcome = rejected`, the refusal in
 *   `result`) and nothing else. A refused batch writes a rejected row per run (the failing one with its refusal, the
 *   others with `batch_failed`) and nothing else, so a retry answers the same way.
 * - **Seq.** The batch's observations take the seqs after `max(observations.seq, tombstones.seq)`, in plan order:
 *   submitted run, the rule runs it caused (depth-first), then the next run. `runs.seq` is the last seq of the run's own
 *   observations. Tombstones of removed edges take the seqs after the batch's observations, so `SeqRange` covers
 *   observations only and the head is the highest seq of either table.
 * - **A config version that is gone** (`deps.config(run.configVersion)` is undefined) throws `ConfigVersionGone` before
 *   anything is written; the caller shows the run for review (docs/07).
 * - All runs of a batch must share one `configVersion` (else the offending run is refused `invalid_input`), and run
 *   ids must be unique within it.
 */
import type {
  Clock,
  CompiledConfig,
  FoldedFeature,
  FormApi,
  Facts,
  Geo,
  PlanLimits,
  Ids,
  PlannedRun,
  RecordedObservation,
  Refusal,
  Run,
  RunId,
  Seq,
} from '@ueberblick/core';
import type { Db } from '../../db/driver';
import type { Logger } from '../../log';
import type { Erasure } from '../../erasure';
import type { VersionCache } from './config-for';
import type { ServerFacts } from '../contract';

/** Inclusive seq range; `to < from` means empty (a run whose plan produced no observation). */
export interface SeqRange {
  readonly from: Seq;
  readonly to: Seq;
}

/**
 * What one submitted run came to. `seq` and `observations` cover the run and every rule run it caused (they are
 * contiguous). The ledger stores the result, so a repeated run id returns it unchanged (F3).
 */
export type SubmitResult =
  | {
      readonly outcome: 'accepted';
      readonly runId: RunId;
      readonly seq: SeqRange;
      readonly observations: readonly RecordedObservation[];
    }
  | { readonly outcome: 'refused'; readonly runId: RunId; readonly refusal: Refusal };

export type AcceptedResult = Extract<SubmitResult, { outcome: 'accepted' }>;

export type BatchResult =
  | {
      readonly outcome: 'accepted';
      /** One accepted result per submitted run, in order. */
      readonly results: readonly AcceptedResult[];
      /** The seq range of the whole batch (H2: one transaction, one range). */
      readonly seq: SeqRange;
    }
  | {
      readonly outcome: 'refused';
      /** The run that caused the refusal, and its refusal. */
      readonly index: number;
      readonly runId: RunId;
      readonly refusal: Refusal;
    };

/** What a hook sees inside the transaction, after the fold (outbox rows and timers are written here). */
export interface TransactionContext {
  readonly db: Db;
  readonly config: CompiledConfig;
  readonly seq: SeqRange;
  /** Every accepted run of the batch with its observations, rule runs included. */
  readonly runs: readonly PlannedRun[];
  /** Features created or changed by the batch, as folded. */
  readonly features: readonly FoldedFeature[];
}
/**
 * Runs inside the run transaction; a throw rolls the whole run back. `hookName` names it in the log (`hook_<name>`).
 */
export type TransactionHook = ((ctx: TransactionContext) => void) & { readonly hookName?: string };

/**
 * A transaction hook threw something other than a busy database: the run is rolled back, never half-written
 * (WP-860). `code` is `hook_<name>`, which `run.failed` logs; the cause stays on `cause`. A `SQLITE_BUSY` is
 * not wrapped: it is transient and answered 503 `busy`.
 */
export class HookFailed extends Error {
  readonly code: string;
  constructor(hook: string, cause: unknown) {
    super(`transaction hook '${hook}' failed`, { cause });
    this.name = 'HookFailed';
    this.code = `hook_${hook}`;
  }
}

export interface StoreDeps {
  readonly clock: Clock;
  /** The process logger (`run.committed`, `run.refused`). Required: a store without one would be silent (R11). */
  readonly log: Logger;
  readonly ids: Ids;
  readonly geo: Geo;
  /** Platform limits handed to plan (rule depth). */
  readonly limits: PlanLimits;
  /** The compiled config of a stored version (`loadConfig(db, version)`); `undefined` when it is gone. */
  readonly config: (version: number) => CompiledConfig | undefined;
  /**
   * The project's shared version cache (`versionCacheFor(db)`): the store, sync and blob access of one database take the
   * same one, so a version is compiled once. Required: a store never builds a cache of its own.
   */
  readonly versions: VersionCache;
  /** core.form's `formApi`. */
  readonly form: FormApi;
  /** After the fold, in order (outbox, timers: WP-107, WP-108). */
  readonly hooks?: readonly TransactionHook[];
  /** The guarded purge a run with a `redact` step executes inside its transaction (default: `createErasure(db)`). */
  readonly erasure?: Erasure;
  /**
   * Called once, after the commit of a run with a `redact` step, with the blobs no value references any more. The caller deletes
   * their bytes (`BlobStore.delete`). A crash before the bytes are gone is finished at restart by `createBlobSweeper`.
   */
  readonly onOrphanedBlobs?: (ids: readonly string[]) => void;
}

/** Thrown before anything is written: the run was made against a config version this server no longer holds. */
export class ConfigVersionGone extends Error {
  constructor(readonly version: number) {
    super(`config version ${version} is not stored`);
    this.name = 'ConfigVersionGone';
  }
}

/** Thrown before anything is written: the project database has no deployed config version, so floating features and creates have none to take. */
export class NoDeployedVersion extends Error {
  constructor() {
    super('no config version is deployed');
    this.name = 'NoDeployedVersion';
  }
}

export interface Store {
  /** core's `Facts` over this database: what plan reads. Independent of any config. */
  readonly facts: Facts;
  /** Facts plus `FeatureAccess` with the inverse relations of one config version (views, evaluation). */
  access(version: number): ServerFacts | undefined;
  /** One run is a batch of one. A refused run writes its ledger row and nothing else. */
  submit(run: Run): SubmitResult;
  /** Atomic: one transaction, one seq range; one refusal refuses the batch. */
  submitBatch(runs: readonly Run[]): BatchResult;
}

export type CreateStore = (db: Db, deps: StoreDeps) => Store;
