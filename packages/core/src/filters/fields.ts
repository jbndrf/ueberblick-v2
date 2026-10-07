/**
 * What a filter builder may offer (WP-640): declared properties the actor can read, each with the operators that
 * fit its type (registry). `filterTerm` writes one clause as rule-language source, so the builder and the saved
 * filter share one encoding (R1, R5). Like v3's builder, an empty clause (no values, blank text, both bounds open)
 * writes nothing, and the clauses of one filter are joined with AND (`joinTerms`).
 */
import type { Actor, Json, Key } from '../model';
import { compilePerms } from '../perms';
import { type PropertyTypeKey } from '../registry';
import { FILTER_OPERATORS_BY_TYPE, type FilterOperator } from '../registry/filter';
import type { CompiledConfig } from '../schema/compile/contract';
import type { FilterField } from './contract';

const permsOf = new WeakMap<CompiledConfig, ReturnType<typeof compilePerms>>();

/** The fields of `type` for `actor`, in declared order. An undeclared type offers none. */
export function filterFields(config: CompiledConfig, type: string, actor: Actor): readonly FilterField[] {
  const def = config.file.types?.[type];
  if (def === undefined) return [];
  let perms = permsOf.get(config);
  if (perms === undefined) permsOf.set(config, (perms = compilePerms(config)));
  const readable = perms.forType(type as Key)?.readable(perms.subjects(actor)) ?? new Set<string>();
  const out: FilterField[] = [];
  for (const [key, p] of Object.entries(def.properties)) {
    if (!readable.has(key)) continue;
    out.push({
      key,
      ...(p.label !== undefined ? { label: p.label } : {}),
      type: p.type,
      operators: FILTER_OPERATORS_BY_TYPE[p.type],
      ...(p.options !== undefined ? { options: p.options } : {}),
    });
  }
  return out;
}

const DATE_TYPES: ReadonlySet<PropertyTypeKey> = new Set(['date', 'datetime']);

/** A literal in the rule language: JSON spells strings, numbers, booleans and lists; dates go through `date()`. */
const literal = (type: PropertyTypeKey, v: Json): string =>
  DATE_TYPES.has(type) && typeof v === 'string' ? `date(${JSON.stringify(v)})` : JSON.stringify(v);

const blank = (v: Json | undefined): boolean =>
  v === undefined || v === null || v === '' || (typeof v === 'string' && v.trim() === '');

/**
 * One clause applied to `self.<key>`, as rule-language source; null when the clause is empty (v3 skips it).
 * Values: `eq` a scalar; `between` `[from, to]` with null for an open end; `older_than_days` / `newer_than_days` a
 * number of days; `in` / `not_in` a list; `contains` / `not_contains` text; `is_empty`, `is_not_empty` and `is_me`
 * none.
 */
export function filterTerm(
  field: { readonly key: string; readonly type: PropertyTypeKey },
  operator: FilterOperator,
  value?: Json,
): string | null {
  const self = `self.${field.key}`;
  const lit = (v: Json): string => literal(field.type, v);
  switch (operator) {
    case 'eq':
      return blank(value) ? null : `${self} == ${lit(value as Json)}`;
    case 'between': {
      const [lo, hi] = Array.isArray(value) ? value : [null, null];
      const parts = [
        blank(lo) ? null : `${self} >= ${lit(lo as Json)}`,
        blank(hi) ? null : `${self} <= ${lit(hi as Json)}`,
      ].filter((p): p is string => p !== null);
      return parts.length === 0 ? null : parts.join(' && ');
    }
    case 'older_than_days':
      return typeof value === 'number' ? `${self} < now - days(${Math.trunc(value)})` : null;
    case 'newer_than_days':
      return typeof value === 'number' ? `${self} > now - days(${Math.trunc(value)})` : null;
    case 'in':
    case 'not_in': {
      if (!Array.isArray(value) || value.length === 0) return null;
      const list = JSON.stringify(value);
      const any = field.type === 'multiselect' ? `${list}.exists(o, o in ${self})` : `${self} in ${list}`;
      return operator === 'in' ? any : `!(${any})`;
    }
    case 'contains':
      return blank(value) ? null : `${self}.contains(${JSON.stringify(value)})`;
    case 'not_contains':
      return blank(value) ? null : `!${self}.contains(${JSON.stringify(value)})`;
    case 'is_empty':
      return `${self} == null`;
    case 'is_not_empty':
      return `${self} != null`;
    case 'is_me':
      return `${self} == actor.id`;
  }
}

/** The clauses of one filter, joined with AND as v3 did; no clause means no restriction (null). */
export function joinTerms(terms: readonly (string | null)[]): string | null {
  const parts = terms.filter((t): t is string => t !== null);
  return parts.length === 0 ? null : parts.map((p) => `(${p})`).join(' && ');
}
