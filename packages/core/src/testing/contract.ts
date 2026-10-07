/**
 * Simulation harness contract (WP-050, docs/07 "Testing"). In-memory fake ports, a seeded simulator and
 * the invariants it checks. Everything here is deterministic from a seed: clock, ids and randomness are
 * injected (R2), so a failing seed replays exactly. Proposed by WP-050 because `testing/contract.ts` did
 * not exist; the lead confirms or amends it.
 */
import type { Actor, Refusal, Run, RunId, Seq } from '../model';
import type { Perms } from '../perms/contract';
import type { CompiledConfig } from '../schema/compile/contract';
import type { MemoryStore } from '../memory';

/** Seeded pseudo-random source; the only randomness a simulation may use. */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/** A run without the fields the simulated device or admin fills in (id, config version). */
export type RunDraft = Omit<Run, 'id' | 'configVersion'>;

/** What the simulation asks of the domain: configs and the runs to try. The simulator itself knows no task. */
export interface Workload {
  readonly config: CompiledConfig;
  readonly perms: Perms;
  /** Participants that own a device, one per device (index modulo length). */
  readonly participants: readonly Actor[];
  readonly admin: Actor;
  /** Loads the starting data as imports (observations of actor kind `import`, no task). */
  seed(store: MemoryStore): void;
  /** One run a participant might try on their device, given what that device currently predicts. May be invalid on purpose. */
  nextRun(rng: Rng, view: MemoryStore, actor: Actor): RunDraft | undefined;
  /** An admin batch (H2): many runs at once, applied to the server whether devices are offline or not. */
  adminBatch?(rng: Rng, view: MemoryStore, admin: Actor): readonly RunDraft[];
}

/** Network fault rates per message, each in [0, 1]. */
export interface NetworkFaults {
  readonly drop: number;
  readonly duplicate: number;
  /** Max extra delay in ticks; different delays reorder messages. */
  readonly maxDelay: number;
}

export interface SimOptions {
  readonly seed: number;
  readonly devices: number;
  /** Simulated ticks before the network heals and everything drains. */
  readonly ticks: number;
  readonly faults: NetworkFaults;
  /** Chance per tick that a device flips between online and offline. */
  readonly offlineFlip: number;
  /** Chance per tick that a device restarts (in-flight state lost, queue and store kept). */
  readonly restart: number;
  /** Chance per tick that a device tries a new run. */
  readonly runRate: number;
  /** Chance per tick that the admin injects a batch. */
  readonly adminRate: number;
}

/** The outcome the server stored for a run id: what a repeated send answers (F3). */
export type LedgerEntry =
  | { readonly ok: true; readonly firstSeq: Seq; readonly lastSeq: Seq }
  | { readonly ok: false; readonly refusal: Refusal };

export interface SubmitResult {
  readonly results: readonly { readonly runId: RunId; readonly entry: LedgerEntry }[];
  /** True when every id was already in the ledger and nothing was applied. */
  readonly replayed: boolean;
}

/** A run a device holds that the server did not accept, kept with its reason and input (never lost). */
export interface RefusedRun {
  readonly run: Run;
  readonly refusal: Refusal;
  readonly where: 'device' | 'server';
}

export interface Violation {
  readonly invariant: 'convergence' | 'no_accepted_run_lost' | 'refusal_leaves_no_trace' | 'quiescence';
  readonly detail: string;
}

export interface SimReport {
  readonly seed: number;
  readonly violations: readonly Violation[];
  /** Deterministic summary of the run, equal for equal seeds. */
  readonly digest: string;
  readonly stats: {
    readonly submitted: number;
    readonly accepted: number;
    readonly refusedOnDevice: number;
    readonly refusedOnServer: number;
    readonly adminBatches: number;
    readonly serverSeq: Seq;
  };
}
