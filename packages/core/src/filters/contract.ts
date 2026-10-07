/**
 * core.filters contract (WP-640, owner answer Q20). One filter format for role presets and personal saved filters:
 * per feature type one rule-language expression over `self`, always clipped by permissions.
 * Pure: the device (and any other side) supplies the facts through `EvalContext`.
 */
import type { TypedAst } from '../expr/check/check';
import type { EvalContext } from '../expr/contract';
import type { Actor, Key } from '../model';
import type { Perms } from '../perms';
import type { PropertyTypeKey } from '../registry';
import type { FilterOperator } from '../registry/filter';
import type { CompiledConfig, Problem } from '../schema/compile/contract';
import type { LocalizedString } from '../schema';

/** A filter as source: a rule-language expression per feature type key. The `filters` of a preset and of a `SavedFilter` (prefs). */
export type FilterSource = Readonly<Record<string, string>>;

/** A filter after `compileFilter`: one checked predicate per feature type. A type without one is not restricted. */
export interface CompiledFilter {
  readonly predicates: ReadonlyMap<Key, TypedAst>;
}

export type FilterCompileResult =
  | { readonly ok: true; readonly filter: CompiledFilter }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** What `applyFilter` needs: the compiled config and perms, who asks, and the facts to evaluate over. */
export interface FilterEnv {
  readonly config: CompiledConfig;
  readonly perms: Perms;
  readonly actor: Actor;
  readonly ctx: EvalContext;
}

/** A property a filter builder may offer, with the operators that fit its type. */
export interface FilterField {
  readonly key: string;
  readonly label?: LocalizedString;
  readonly type: PropertyTypeKey;
  readonly operators: readonly FilterOperator[];
  /** select / multiselect: option key to label. */
  readonly options?: Readonly<Record<string, LocalizedString>>;
}
