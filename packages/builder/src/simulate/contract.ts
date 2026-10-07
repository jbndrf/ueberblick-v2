/**
 * The simulator's headless session (docs/08 "Simulates"). It runs the same `core.plan` and
 * `core.fold` as the device and the server (R2): the session only supplies in-memory ports and
 * reports what core returned. No DOM, no I/O, so the assistant's `simulate` tool (WP-211, H4) calls it too.
 */
import type {
  Actor,
  AutoId,
  CompiledConfig,
  Geo,
  Explanation,
  FeatureId,
  FeatureState,
  Json,
  Facts,
  Key,
  Observation,
  Problem,
  RecordedObservation,
  Refusal,
  FireResult,
} from '@ueberblick/core';

/** A feature to put into the sandbox before a simulation (an import: no task, no permissions). */
export interface SeedFeature {
  /** Minted when absent. */
  readonly id?: FeatureId;
  readonly type: Key;
  readonly properties: { readonly [property: string]: Json };
}

/** One offered-or-not task on a feature for an actor: the input of the "why not" line. */
export type TaskAvailability =
  | { readonly task: Key; readonly ok: true }
  | {
      readonly task: Key;
      readonly ok: false;
      readonly refusal: Refusal;
      /** The decisive sub-expressions of `when`, from `core.expr.explain`. */
      readonly explanation?: Explanation;
    };

/** One run of a submitted batch: the submitted run or a rule-caused system run. */
export interface SimulatedRun {
  readonly runId: string;
  readonly task: Key;
  readonly actorKind: Actor['kind'];
  /** 0 for a submitted run; a rule's run is one deeper than the run that triggered it. */
  readonly depth: number;
  /** The run that caused this one (a rule chain), absent for a submitted run. */
  readonly causedBy?: string;
  /** The automatic action (id `<task>.<name>`) that started this run (named by `core.plan`); absent for a submitted run. */
  readonly rule?: AutoId;
  /** For the root run of a time-based rule: when its timer was due (`trigger: { kind: 'timer' }` in core's trace). */
  readonly dueAt?: string;
  readonly observations: readonly RecordedObservation[];
  readonly created: readonly FeatureId[];
}

export interface FeatureChange {
  readonly id: FeatureId;
  /** Absent when the batch created the feature. */
  readonly before: FeatureState | undefined;
  readonly after: FeatureState;
}

export type SimulationResult =
  | {
      readonly ok: true;
      /** Submitted runs in order, each followed by the rule runs it caused. */
      readonly runs: readonly SimulatedRun[];
      /** State of every touched feature before and after the batch. */
      readonly changes: readonly FeatureChange[];
      /** True when the batch was applied to the sandbox (`commit`). */
      readonly committed: boolean;
      readonly ms: number;
    }
  | { readonly ok: false; readonly runId: string; readonly refusal: Refusal; readonly ms: number };

export interface SimulationRun {
  readonly task: Key;
  readonly actor: Actor;
  readonly feature?: FeatureId;
  readonly input?: { readonly [field: string]: Json };
}

export interface SubmitOptions {
  /** Apply an accepted batch to the sandbox. Default true; false is a dry run. */
  readonly commit?: boolean;
}

/** One rule considered (core's rule trace, `docs/03`). */
export type RuleTrace = NonNullable<FireResult['trace']>;

/** A time-based rule that came due in the sandbox: what the server timer would hand to `PlanApi.fireRule`. */
export interface FireRuleRequest {
  readonly rule: AutoId;
  /** The feature the timer is about (`self`); absent for a `schedule` rule. */
  readonly subject?: FeatureId;
  /** When the timer was due. */
  readonly dueAt: string;
}

export interface FireRuleOptions {
  /** Apply the rule's runs to the sandbox. Default true; false is a dry run. */
  readonly commit?: boolean;
  /** The clock for this firing (the rule's `when` and `with` read `now`). Default: the session clock. */
  readonly now?: string;
}

export type FireRuleResult =
  | {
      readonly ok: true;
      /** Empty when the rule's `when` is false (the trace says why). Else the rule's run, then the runs it caused. */
      readonly runs: readonly SimulatedRun[];
      readonly trace: RuleTrace;
      readonly committed: boolean;
    }
  | { readonly ok: false; readonly refusal: Refusal; readonly trace: RuleTrace };

export interface Simulation {
  /** The compiled effective file the session runs (for `explain`, which reads compiled expressions). */
  readonly config: CompiledConfig;
  readonly geo: Geo;
  /** The sandbox as the `Facts` port (read-only use): what `core.plan` and `explain` read. */
  readonly facts: Facts;
  /** A copy of the sandbox with `observations` applied; the sandbox itself is unchanged. */
  factsAfter(observations: readonly Observation[]): Facts;
  /** The sandbox's features, optionally of one type. */
  features(type?: Key): readonly FeatureState[];
  feature(id: FeatureId): FeatureState | undefined;
  /** Puts features in as an import (no permissions, no task). */
  seed(features: readonly SeedFeature[]): readonly FeatureId[];
  /** A feature with a plausible value for every property of `type`, put into the sandbox. */
  generate(type: Key, overrides?: { readonly [property: string]: Json }): FeatureId;
  /** Every task of the feature's type, available or with the reason it is not. */
  availability(feature: FeatureId, actor: Actor): readonly TaskAvailability[];
  /** A task that starts without a feature (`$map`, `$none` offers). */
  availabilityWithout(task: Key, actor: Actor): TaskAvailability;
  submit(run: SimulationRun, options?: SubmitOptions): SimulationResult;
  /** Fires one time-based rule that came due, through `core.plan.fireRule` (the server's timers do the same). */
  fireRule(fire: FireRuleRequest, options?: FireRuleOptions): FireRuleResult;
  /** An atomic batch (H2): one refusal refuses all. */
  submitBatch(runs: readonly SimulationRun[], options?: SubmitOptions): SimulationResult;
}

export type OpenSimulationResult =
  | { readonly ok: true; readonly simulation: Simulation }
  | { readonly ok: false; readonly problems: readonly Problem[] };

export interface OpenSimulationOptions {
  /** The injected clock (core never reads one). Default: 2026-05-01T08:00:00.000Z. */
  readonly now?: string;
  readonly configVersion?: number;
}
