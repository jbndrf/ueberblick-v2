/**
 * core.plan contract (docs/03 "life of a run", docs/05 tasks and rules, docs/02 F3).
 * CONTRACT — written by the lead; changes need the lead. Implemented by WP-041, consumed by the
 * server run transaction (WP-104), the device run queue (WP-511), the simulation (WP-050) and the
 * builder simulator.
 *
 * plan is pure (R2): time, ids and geometry arrive through ports; it never throws for bad input,
 * it refuses. A batch is atomic (H2): one refusal refuses the whole batch. Inside a batch, later runs
 * and rule runs see the observations of earlier ones (plan layers its own output over `facts` via
 * core.fold; it never mutates `facts`). Form semantics come only from core.form (form/contract.ts). Rules triggered by events run to depth `ports.limits.ruleDepth` (callers pass PLAN_MAX_RULE_DEPTH unless the platform config says otherwise);
 * time-based rules (`elapsed`, `schedule`) are fired by the server clock, one at a time, through `PlanApi.fireRule` (same code path, docs/07).
 */
import type { Geo } from '../geo/contract';
import type { Perms } from '../perms/contract';
import type { Clock, Facts, Ids } from '../ports';
import type { CompiledConfig } from '../schema/compile/contract';
import type { AutoId } from '../schema/compile/autos';
import type { Actor, FeatureId, Instant, Key, Observation, Refusal, Run, RunId } from '../model';
import type { Explanation } from '../expr/sql/contract';
import type { RuleTraceReason, RuleTraceTriggerKind } from '../registry/rule-trace';
import type { RedactPair } from './redact';

/** Maximum nesting of event-triggered rule runs (a run triggers a rule whose run triggers a rule …). */
export const PLAN_MAX_RULE_DEPTH = 8;

/** Platform limits the caller decides (the seam for further limits such as batch size). */
export interface PlanLimits {
  /** Maximum nesting of event-triggered rule runs. */
  readonly ruleDepth: number;
}

export interface PlanPorts {
  readonly clock: Clock;
  readonly facts: Facts;
  readonly geo: Geo;
  readonly limits: PlanLimits;
  /**
   * Whether an id is a participant of the project (WP-756). The server knows every member and passes it; a device
   * knows only the people it was shipped, so it leaves it out and the server stays authoritative. Absent: the
   * membership of a chosen participant is not checked.
   */
  readonly isParticipant?: (id: string) => boolean;
}

/**
 * The ports of the timer entry point: `PlanPorts` plus the ids of a timer rule run. `planFor` has no `ids` port: the
 * ids of what a submitted run creates are `seededIds(run.id)`, the same on every side (docs/04 "Ids").
 */
export interface RulePorts extends PlanPorts {
  readonly ids: Ids;
}

/** One accepted run (submitted or rule-caused) with the observations it produces. */
export interface PlannedRun {
  readonly run: Run;
  /** The rule that caused this run; absent for submitted (user) runs. */
  readonly rule?: AutoId;
  /** In application order; every observation's feature exists after the batch (or is created by it). */
  readonly observations: readonly Observation[];
  /** Features this run created (a `$type` observation among `observations`). */
  readonly created: readonly FeatureId[];
  /**
   * Erasure (B-005): the (feature, property) pairs whose superseded results and run inputs the server blanks in place,
   * in the run's transaction, next to appending `observations` (which hold the null observations of the same pairs).
   * `[]` for every run that redacts nothing. Invariant: the deduplicated union of every `erased[].purge`
   * (kept flat for the hot-path length check).
   */
  readonly purge: readonly RedactPair[];
  /**
   * One entry per `redact` step, in order: the subject (a participant id, or a feature id; what `erasure_subjects`
   * records) and that step's own pairs, without duplicates. `[]` when `purge` is.
   */
  readonly erased: readonly { readonly subject: string; readonly purge: readonly RedactPair[] }[];
}

/** Options of `plan`; additive, defaults off. */
export interface PlanOptions {
  /** Return `trace`: why each rule considered during the batch fired or did not. Off allocates nothing. */
  readonly trace?: boolean;
}

/**
 * What set a rule going, discriminated on the registry `RULE_TRACE_TRIGGER_KINDS`: a run whose changes were checked
 * (event rules, and the rules a timer's system run causes), or a timer that came due (`PlanApi.fireRule`).
 */
export type RuleTraceTrigger = {
  readonly [K in RuleTraceTriggerKind]: K extends 'run'
    ? { readonly kind: K; readonly causedBy: RunId }
    : { readonly kind: K; readonly dueAt: Instant };
}[RuleTraceTriggerKind];

/** One rule considered (docs/03 "Rule trace"), in chain order (depth-first): the root of a chain comes first. */
export interface RuleTraceEntry {
  /** The automatic action considered, `<task>.<name>`. */
  readonly rule: AutoId;
  readonly reason: RuleTraceReason;
  /** Nesting of the causing run: 0 for a submitted run or a timer. */
  readonly depth: number;
  /** What set the rule going: the run whose changes were checked, or the timer that came due. */
  readonly trigger: RuleTraceTrigger;
  /** The feature the rule would run on. */
  readonly subject?: FeatureId;
  /** `when_false`: the decisive sub-expressions, from `expr.explain`. */
  readonly explanation?: Explanation;
  /** `refused` and `depth_exceeded`: the refusal that ended the batch. */
  readonly refusal?: Refusal;
  /** `fired`: the rule run planned. */
  readonly run?: RunId;
}

export type PlanResult =
  | {
      readonly ok: true;
      /** Present only with `options.trace`. */
      readonly trace?: readonly RuleTraceEntry[];
      /** Submitted runs in order, each followed by the rule runs it caused (depth-first), `causedBy` set. */
      readonly runs: readonly PlannedRun[];
    }
  | {
      readonly ok: false;
      /** The run that was refused (a submitted run, or the submitted run whose rule chain failed). */
      readonly runId: RunId;
      /** `code` from the refusal registry (packages/core/src/registry/refusals.ts). */
      readonly refusal: Refusal;
      /** Present only with `options.trace`; ends with the entry that refused. */
      readonly trace?: readonly RuleTraceEntry[];
    };

/** Where a task would be started: on a feature, on a map position (`$map`), or with no target (`$none`). */
export type TaskTarget = { readonly feature: FeatureId } | { readonly map: true } | { readonly none: true };

export type Availability =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** The same refusal `plan` would return for a run of this task on this target. */
      readonly refusal: Refusal;
      /** Why `when` was false, for the ui ("not available because …"). */
      readonly explanation?: Explanation;
    };

/** A time-based rule that came due (docs/07): the server timer names it; nothing else about it is decided outside core. */
export interface RuleFire {
  /** The automatic action's id, `<task>.<name>` (its timing is `elapsed` or `schedule`). */
  readonly rule: AutoId;
  /** The feature the timer is about (`self`); absent for a `schedule` rule. */
  readonly subject?: FeatureId;
  /** The config version the rule was read from; stamped on the system run. */
  readonly configVersion: Run['configVersion'];
  /** When the timer was due; recorded as the trace root's `trigger.dueAt`. */
  readonly dueAt: Instant;
}

export type FireResult =
  | {
      readonly ok: true;
      /** Empty when the rule's `when` is false. Else the rule's system run, then the rule runs it caused. */
      readonly runs: readonly PlannedRun[];
      /** Present only with `options.trace`. */
      readonly trace?: readonly RuleTraceEntry[];
    }
  | {
      readonly ok: false;
      readonly refusal: Refusal;
      /** Present only with `options.trace`; ends with the entry that refused. */
      readonly trace?: readonly RuleTraceEntry[];
    };

/** The key `ConfigFor` gets for a feature that does not exist yet (a create floats on the deployed version, A-029). */
export const NEW_FEATURE = 'new' as const;

/** The compiled config and permissions one feature is planned under. */
export interface ResolvedConfig {
  readonly config: CompiledConfig;
  readonly perms: Perms;
  /**
   * The config version these belong to. When set, a run planned under another version is replanned under this one
   * and stamped with it (A-029 L1); a rule run is stamped with it. Absent: the caller tracks no versions (the
   * one-version adapter), runs keep the version they carry.
   */
  readonly version?: Run['configVersion'];
}

/**
 * Resolves the config of a feature (A-029 §2): a pinned feature gets its pinned version, a floating one the deployed
 * version, `NEW_FEATURE` (a create) the deployed version. Called at most once per key per `plan` call (cached).
 */
export type ConfigFor = (feature: FeatureId | typeof NEW_FEATURE) => ResolvedConfig;

/** The one-version adapter: every feature resolves to `config` and `perms`; `version` is left to the runs. */
export const oneVersion = (config: CompiledConfig, perms: Perms): ConfigFor => {
  const resolved: ResolvedConfig = { config, perms };
  return () => resolved;
};

export interface PlanApi {
  /**
   * The four operations, resolving each feature's config through `configFor` (A-029 §2).
   * A run on a feature is planned under that feature's version; a create under the deployed one; a write to another
   * feature is validated under the target's; a rule run under its subject's. A run carrying another
   * `configVersion` than the feature's is replanned under the feature's (L1): a refusal of the replan is the refusal.
   */
  availableFor(
    task: Key,
    target: TaskTarget,
    actor: Actor,
    configFor: ConfigFor,
    ports: PlanPorts,
  ): Availability;
  availableTasksFor(feature: FeatureId, actor: Actor, configFor: ConfigFor, ports: PlanPorts): readonly Key[];
  fireRuleFor(fire: RuleFire, configFor: ConfigFor, ports: RulePorts, options?: PlanOptions): FireResult;
  planFor(batch: readonly Run[], configFor: ConfigFor, ports: PlanPorts, options?: PlanOptions): PlanResult;
}
