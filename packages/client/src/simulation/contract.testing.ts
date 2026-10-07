/**
 * Simulation against the real device adapters (WP-513). The WP-050 harness (`@ueberblick/core/testing`) checks
 * the three invariants with in-memory stand-ins; this one runs the same idea with the real IndexedDB store
 * (fake-indexeddb), run queue and sync worker on the device side and, behind the `SimBackend` port, the real
 * run store and sync service (SQLite) on the server side. Everything is a pure function of the seed.
 *
 * The client package may not import the server package, so the server is a port: `fixtures/golden/simulation`
 * builds the backend and runs the specs.
 */
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { LifecycleState } from '@ueberblick/core/registry';
import type { MemoryStore } from '@ueberblick/core/memory';
import type { Actor, FeatureId, Json, Run, RunId, Seq } from '@ueberblick/core/model';
import type { NetworkFaults, Violation } from '@ueberblick/core/testing';
import type { RunTransport } from '../queue';
import type { EncodedSyncTransport } from '../sync';

/** What the server holds about one run id (the ledger). */
export interface AuditedRun {
  readonly outcome: 'accepted' | 'rejected';
  readonly actorKind: string;
  /** Set for a run a rule caused on the server. */
  readonly causedBy: RunId | undefined;
}

export interface AuditedFeature {
  readonly type: string;
  readonly properties: Readonly<Record<string, Json>>;
  readonly lifecycle: LifecycleState;
}

/** The server's state, read straight from its tables after a simulation, for the invariants. */
export interface ServerAudit {
  readonly head: Seq;
  readonly runs: ReadonlyMap<RunId, AuditedRun>;
  /** Observation rows as (seq, run), ascending. */
  readonly observations: readonly { readonly seq: Seq; readonly runId: RunId }[];
  /** Seqs of tombstones (removed edges take seqs after a batch's observations). */
  readonly tombstoneSeqs: readonly Seq[];
  readonly features: ReadonlyMap<FeatureId, AuditedFeature>;
  /** Problems the server's own check found: its tables must equal a from-scratch `core.fold` of the log. */
  readonly foldMismatches: readonly string[];
}

/**
 * The server side of a simulation. Transports are what the app would build from `fetch`: they carry HTTP-shaped
 * answers through the real endpoint handlers, so a fault injected around them is a fault on the wire.
 */
export interface SimBackend {
  readonly config: CompiledConfig;
  /** Highest seq of the log (observations and tombstones). Cheap: the drain asks it every round. */
  head(): Seq;
  /** Seeds are facts, not runs: `fill` writes them into a scratch `MemoryStore`, the backend ingests its log. */
  seed(fill: (store: MemoryStore) => void): void;
  runTransport(actor: Actor): RunTransport;
  syncTransport(actor: Actor): EncodedSyncTransport;
  /** An admin batch straight to the server (H2): one atomic request, no device involved. */
  submitDirect(runs: readonly Run[]): void;
  /** Reads every table: call it once, after the drain. */
  audit(): ServerAudit;
}

export interface RealSimOptions {
  readonly seed: number;
  readonly devices: number;
  /** Runs each device tries (some are invalid on purpose, so refusals happen). */
  readonly runsPerDevice: number;
  readonly faults: NetworkFaults;
  /** Chance per tick that a device flips between online and offline. */
  readonly offlineFlip: number;
  /** Chance per tick that a device restarts (in-flight state lost, store kept). */
  readonly restart: number;
  /** Chance per tick that a device with runs left tries one. */
  readonly runRate: number;
  /** Chance per tick that the admin injects a batch straight into the server. */
  readonly adminRate: number;
  /** Chance per tick that a `verwaltung` device submits an atomic batch (H2). */
  readonly batchRate: number;
  /** Rounds the fault-free drain may take before the run counts as never quiet (default 400). */
  readonly drainRounds?: number;
  /** Ticks after which the run phase stops even if runs are left (a runaway guard, not a knob). */
  readonly maxTicks?: number;
}

export interface RealSimStats {
  readonly submitted: number;
  readonly accepted: number;
  readonly refusedOnDevice: number;
  readonly refusedOnServer: number;
  readonly adminBatches: number;
  readonly deviceBatches: number;
  readonly restarts: number;
  readonly ticks: number;
  readonly serverSeq: Seq;
  readonly requestsLost: number;
  readonly repliesLost: number;
  readonly duplicates: number;
  readonly lateDuplicates: number;
}

export interface RealSimReport {
  readonly seed: number;
  readonly options: RealSimOptions;
  readonly violations: readonly Violation[];
  /** Deterministic summary, equal for equal seeds. */
  readonly digest: string;
  readonly stats: RealSimStats;
}
