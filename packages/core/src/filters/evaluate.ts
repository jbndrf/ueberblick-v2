/**
 * Evaluates a compiled filter over features (WP-640). The only evaluator is `core.expr` (R5); this module adds
 * the clip: a filter never returns a feature the actor cannot see, and a filter that reads a property the actor
 * cannot read matches nothing (a negated test on a hidden value must not reveal it either).
 */
import type { EvalContext, EvalValue } from '../expr/contract';
import { condition } from '../expr/evaluate';
import { HISTORY_FUNCTIONS } from '../expr/functions';
import { children } from '../expr/parse';
import type { Expr } from '../expr/ast';
import type { TypedAst } from '../expr/check/check';
import type { FeatureState, Key } from '../model';
import { actorValue } from '../perms';
import { isLive } from '../registry/lifecycle';
import type { CompiledFilter, FilterEnv } from './contract';

/** The properties of `type` the filter's actor may read; an undeclared type reads nothing. */
function readableOf(env: FilterEnv, type: string): ReadonlySet<string> {
  return env.perms.forType(type as Key)?.readable(env.perms.subjects(env.actor)) ?? new Set();
}

/** Does `typed` read only properties the actor may read? Walks member access on every feature-typed value. */
function readsOnlyReadable(env: FilterEnv, typed: TypedAst, selfType: string): boolean {
  const cache = new Map<string, ReadonlySet<string>>();
  const readable = (type: string): ReadonlySet<string> => {
    let r = cache.get(type);
    if (r === undefined) cache.set(type, (r = readableOf(env, type)));
    return r;
  };
  const allowed = (type: string, field: string): boolean => {
    const def = env.config.file.types?.[type];
    if (def === undefined) return false;
    // `geometry` is the alias of the primary geometry property.
    const prop = field === 'geometry' && def.geometry !== undefined ? def.geometry : field;
    return !Object.hasOwn(def.properties, prop) || readable(type).has(prop);
  };
  const stack: Expr[] = [typed.ast];
  while (stack.length > 0) {
    const node = stack.pop() as Expr;
    if (node.kind === 'member') {
      const ty = typed.types.get(node.object);
      if (ty?.kind === 'feature' && !allowed(ty.type, node.field)) return false;
    } else if (node.kind === 'call' && node.target === undefined && HISTORY_FUNCTIONS.includes(node.name)) {
      const first = node.args[0];
      if (first?.kind === 'literal' && typeof first.value === 'string' && !allowed(selfType, first.value))
        return false;
    }
    stack.push(...children(node));
  }
  return true;
}

/**
 * The features of `type` that the actor sees and that pass the filter, in input order. A type the filter has no
 * predicate for passes every visible feature. Cost: one `canSee` and one `condition` per feature of the type.
 */
export function applyFilter(
  env: FilterEnv,
  filter: CompiledFilter,
  type: string,
  features: Iterable<FeatureState>,
): readonly FeatureState[] {
  const perms = env.perms.forType(type as Key);
  if (perms === undefined) return [];
  const subjects = env.perms.subjects(env.actor);
  const predicate = filter.predicates.get(type as Key);
  if (predicate !== undefined && !readsOnlyReadable(env, predicate, type)) return [];
  const vars = new Map<string, EvalValue>(env.ctx.vars);
  vars.set('actor', actorValue(env.actor));
  const ctx: EvalContext = { ...env.ctx, vars };
  const out: FeatureState[] = [];
  for (const f of features) {
    if (f.type !== type || !isLive(f)) continue;
    vars.set('self', { $feature: f.id });
    if (!perms.canSee(subjects, f, ctx).ok) continue;
    if (predicate === undefined || condition(predicate, ctx).value) out.push(f);
  }
  return out;
}
