import type { Span } from '../ast';
import type { ExprTypeKind } from '../../registry';
import type { ExprErrorCode, ExprErrorParams } from '../../registry/expr-errors';

/** Scalar-like types: no parameters. */
export interface SimpleTy {
  readonly kind: Exclude<ExprTypeKind, 'list' | 'map' | 'record' | 'feature'>;
}
export interface ListTy {
  readonly kind: 'list';
  readonly element: Ty;
}
export interface MapTy {
  readonly kind: 'map';
  readonly key: Ty;
  readonly value: Ty;
}
export interface RecordTy {
  readonly kind: 'record';
  readonly fields: Readonly<Record<string, Ty>>;
}
/** Refers to `Env.features[type]`; a name (not the fields) so that relations may be cyclic. */
export interface FeatureTy {
  readonly kind: 'feature';
  readonly type: string;
}
export type Ty = SimpleTy | ListTy | MapTy | RecordTy | FeatureTy;

/** One overload of a function. `target` is set for receiver-style calls (`s.startsWith(t)`). */
export interface FunctionSig {
  readonly target?: Ty;
  readonly params: readonly Ty[];
  readonly returns: Ty;
}

/** Everything `check` needs to know. Plain data, generated from the config by `compile()`. */
export interface Env {
  /** Names in scope: `self`, `form`, `actor`, `inputs`, `value`, `other`, `now` and `bind` names. */
  readonly vars: Readonly<Record<string, Ty>>;
  /** Property and relation types per feature type. A to-many relation is a `list` of `feature`. */
  readonly features: Readonly<Record<string, Readonly<Record<string, Ty>>>>;
  /** Overrides the built-in function signatures. */
  readonly functions?: Readonly<Record<string, readonly FunctionSig[]>>;
  /** True for device-evaluated contexts: history functions are limited to 10 values. */
  readonly device?: boolean;
  /** True where the expression compiles to SQL (`visible_when`, derived relations, view and row filters): system fields without a column (`sql: false`) are refused. */
  readonly sql?: boolean;
}

export interface CheckOptions {
  /** The required result type (`when` and `relevant` need bool). */
  readonly expect?: Ty;
}

/**
 * A type error with a source span and, where possible, a fix hint. `message` and `hint` are English;
 * `code` and `params` (plus `params.hint_variant` when the registry lists hint variants) word them elsewhere.
 */
export interface CheckError {
  readonly message: string;
  readonly span: Span;
  readonly hint?: string;
  readonly code: ExprErrorCode;
  readonly params: ExprErrorParams;
}
