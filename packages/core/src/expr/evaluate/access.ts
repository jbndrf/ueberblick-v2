/** Member access on maps and features: properties, relation traversal and `has()`. Missing means null. */
import type { Key } from '../../model';
import type { EvalContext, EvalValue, FeatureRef } from '../contract';
import { fail, isFeatureRef, isMap } from '../functions/support';
import { valueKind } from './ops';

const ref = (f: FeatureRef['$feature']): FeatureRef => ({ $feature: f });

function relationOf(ctx: EvalContext, f: FeatureRef, field: string): boolean {
  const type = ctx.features.type(f.$feature);
  return type !== undefined && ctx.relations.get(type)?.has(field as Key) === true;
}

/** A feature's declared relation `field`, after its own property of that name was found missing. */
export function related(ctx: EvalContext, f: FeatureRef, field: string, many: boolean): EvalValue {
  if (!relationOf(ctx, f, field)) return null;
  const ids = ctx.features.related(f.$feature, field as Key);
  if (many) return ids.map(ref);
  const first = ids[0];
  return first === undefined ? null : ref(first);
}

/**
 * `object.field`. A feature's own property wins; otherwise a declared relation is followed:
 * `many` (a to-many relation, or unknown) gives a list, otherwise the single feature or null.
 * Null propagates: a member of null is null.
 */
export function member(ctx: EvalContext, obj: EvalValue, field: string, many: boolean): EvalValue {
  if (obj === null) return null;
  if (isFeatureRef(obj)) {
    const p = ctx.features.property(obj.$feature, field);
    return p !== undefined ? p : related(ctx, obj, field, many);
  }
  if (isMap(obj)) {
    const v = Object.hasOwn(obj, field) ? obj[field] : undefined;
    return v === undefined ? null : v;
  }
  return fail(`cannot read '${field}' of ${valueKind(obj)}`);
}

/** `has(object.field)`: the property or relation holds something other than null. */
export function present(ctx: EvalContext, obj: EvalValue, field: string): boolean {
  if (obj === null) return false;
  if (isFeatureRef(obj)) {
    const p = ctx.features.property(obj.$feature, field);
    if (p !== undefined) return p !== null;
    return relationOf(ctx, obj, field) && ctx.features.related(obj.$feature, field as Key).length > 0;
  }
  if (isMap(obj)) return Object.hasOwn(obj, field) && obj[field] !== null && obj[field] !== undefined;
  return fail(`has() needs a record or map but got ${valueKind(obj)}`);
}
