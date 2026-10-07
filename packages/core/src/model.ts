/**
 * Core domain types shared by every module (docs/01-glossary.md, docs/04-data-model.md).
 * CONTRACT — changes need the lead. Module-specific contracts live in src/<module>/contract.ts.
 */
import type { ActorKind } from './registry';
import type { LifecycleState } from './registry/lifecycle';

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** UUIDv7, minted on the device (F1). */
export type FeatureId = Brand<string, 'FeatureId'>;
/** UUIDv7, minted on the device; also the idempotency key (F3). */
export type RunId = Brand<string, 'RunId'>;
export type ParticipantId = Brand<string, 'ParticipantId'>;
/** A config key: ^[a-z][a-z0-9_]*$ — validated by the schema (F1). */
export type Key = Brand<string, 'Key'>;
/** Server-assigned global order; the sync cursor (F12). */
export type Seq = number;
/** ISO-8601 timestamp string. Core never reads a clock; time arrives via ports. */
export type Instant = string;
/** Any JSON value stored as an observation result. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };

export interface Actor {
  readonly id: string;
  readonly kind: ActorKind;
  readonly roles: readonly Key[];
}

/** One execution of a task by an actor — the only write operation (F3). */
export interface Run {
  readonly id: RunId;
  readonly task: Key;
  readonly actor: Actor;
  readonly configVersion: number;
  /** Primary feature (`self`); absent for tasks that create one. */
  readonly featureId?: FeatureId;
  /** Form values keyed by field key, plus task-specific input (e.g. geometry). */
  readonly input: { readonly [field: string]: Json };
  readonly clientTime?: Instant;
  /** Set for system runs triggered by a rule. */
  readonly causedBy?: RunId;
  /**
   * The automatic action (`tasks.<t>.auto.<key>`) this system run is the run of. Set by `fireOne` and by the timers; the one
   * thing that lets the system skip a task's `who` (`whoAdmits`). Never stored and never accepted from a client.
   */
  readonly auto?: Key;
}

/** One value of one property of one feature (F4, OGC O&M). */
export interface Observation {
  readonly featureId: FeatureId;
  /** Property key; reserved: `$type`, `$lifecycle`, `$created_by`, `$version`. */
  readonly property: string;
  readonly result: Json;
  readonly phenomenonTime?: Instant;
  /**
   * O&M `resultTime`: when the result became available. The intake sets it (`resultTimeOf`): the server receive time,
   * or for an import the historical time. Absent on a prediction a device made and has not synced. The audit times
   * ("Erstellt", "Zuletzt geändert") read it (WP-794); `phenomenonTime` stays the work time.
   */
  readonly resultTime?: Instant;
}

/** An observation as persisted: with its run and global order. */
export interface RecordedObservation extends Observation {
  readonly seq: Seq;
  readonly runId: RunId;
}

/**
 * System audit metadata of a feature (A-028 item 3, owner Q23/Q26), derived by fold: who started it and when, and when
 * it last changed. The times are `resultTime`s (the server receive time), or the `phenomenonTime` for a not yet synced
 * prediction; a field is absent when neither exists. `createdBy` is an actor id, never redacted.
 */
export interface FeatureAudit {
  readonly createdBy?: string;
  readonly createdAt?: Instant;
  readonly changedAt?: Instant;
}

/** Current state of a feature — produced only by core.fold (F4). */
export interface FeatureState extends FeatureAudit {
  readonly id: FeatureId;
  readonly type: Key;
  readonly properties: { readonly [key: string]: Json };
  /** System lifecycle (registry `LIFECYCLE_STATES`); `$type` starts it at `active`. */
  readonly lifecycle: LifecycleState;
  readonly updatedSeq: Seq;
  /**
   * The config version the feature is pinned to (A-029, reserved key `$version`, integer = `config_versions.version`).
   * Absent: the feature floats on the deployed version. Written only by system and admin runs, never redacted.
   */
  readonly pinnedVersion?: number;
  /**
   * The config version this feature follows on a device: `coalesce(pinnedVersion, deployed)`, as the sync sent it
   * (`SyncFeature.version`, A-029). Absent on a feature the device made or a server read: then the deployed version
   * applies. One type for the sync row, the device store and the predictor; the resolver is `config/resolver.ts`.
   */
  readonly version?: number;
}

/** A stored relation instance (F9). */
export interface Edge {
  readonly from: FeatureId;
  readonly relation: Key;
  readonly to: FeatureId;
  readonly derived: boolean;
}

/** Why a run was not accepted; `code` comes from the refusal registry (WP-041). */
export interface Refusal {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

// Config types for participant code (WP-129): type-only, so importing /model never loads Zod.
export type {
  FeatureType,
  JsonValue,
  LocalizedString,
  MapConfig,
  MapLayer,
  Property,
  Task,
  TemplateFile,
  View,
} from './schema';
// Type-only, so the /model entry stays free of the compiler, the fold and the geo engine (WP-562).
export type { CompiledConfig } from './schema/compile/contract';
export type { FoldedFeature } from './fold/contract';
export type { Derived } from './geo/contract';
export type { PropertyTypeKey } from './registry/property-types';
export type { Clock } from './ports';
