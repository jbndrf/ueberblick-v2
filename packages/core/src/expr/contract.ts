/**
 * Evaluation contract (docs/06-rule-language.md). CONTRACT — written by the lead; changes need
 * the lead. Implemented by WP-021 (`evaluate`), consumed by plan (WP-041), the builder simulator
 * and the device. Evaluation is total: it never throws and never reads a clock or random source.
 */
import type { Geo } from '../geo/contract';
import type { FeatureId, Instant, Json, Key, RecordedObservation } from '../model';
import type { Span } from './ast';
import type { TypedAst } from './check/check';

/** A reference to a feature; members are resolved lazily through `FeatureAccess`. */
export interface FeatureRef {
  readonly $feature: FeatureId;
}

/** A runtime value: JSON, a feature reference, or a list of either (relation sets, macros). */
export type EvalValue = Json | FeatureRef | readonly EvalValue[];

/**
 * Read access to features during evaluation. Both sides implement it over their `Facts` port
 * (packages/core/src/ports.ts); relation names come from the compiled config.
 */
export interface FeatureAccess {
  /** Current value of a property; `undefined` if the feature or property does not exist. */
  property(id: FeatureId, key: string): Json | undefined;
  /** Features reached through a declared relation (references, derived relations, inverses). */
  related(id: FeatureId, relation: Key): readonly FeatureId[];
  /** Newest first, at most `limit`; devices hold the last 10 per property. */
  history(id: FeatureId, property: string, limit: number): readonly RecordedObservation[];
  /** The feature type, so member access knows whether a name is a property or a relation. */
  type(id: FeatureId): Key | undefined;
}

export interface EvalContext {
  /** In-scope variables: `self`, bind names, `form`, `value`, `actor`, `inputs`, `other`. */
  readonly vars: ReadonlyMap<string, EvalValue>;
  readonly features: FeatureAccess;
  /** Injected time; `now` and `today()` read only this. */
  readonly now: Instant;
  /** Relation keys per feature type key (from the compiled config), to tell relations from properties. */
  readonly relations: ReadonlyMap<Key, ReadonlySet<Key>>;
  /** Geometry port: spatial functions call it. Required, so a missing geo never turns a condition silently false. */
  readonly geo: Geo;
}

export interface EvalError {
  readonly message: string;
  readonly span: Span;
}

export type EvalResult =
  { readonly ok: true; readonly value: EvalValue } | { readonly ok: false; readonly error: EvalError };

export interface EvaluateApi {
  evaluate(typed: TypedAst, ctx: EvalContext): EvalResult;
  /**
   * For `when`, `relevant` and other conditions: an error or a non-bool counts as `false` and is
   * returned for reporting (docs/06 "Evaluation is total").
   */
  condition(typed: TypedAst, ctx: EvalContext): { readonly value: boolean; readonly error?: EvalError };
}
