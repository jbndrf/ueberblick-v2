/**
 * The evaluator of one pass over a view (WP-847): the context, the actor value and the compiled filter are built once
 * and `self` is rebound per feature; a read of another feature (the hop target of `self.flaeche.name`) is answered
 * once per pass, however many features point at it. `featureAccess` stays the one reader of features (R1).
 * Hold one for one pass or one slice only: the memo is not invalidated when the facts change.
 */
import { condition } from '@ueberblick/core/expr';
import type { EvalContext, FeatureAccess } from '@ueberblick/core/expr';
import type { Geo } from '@ueberblick/core/geo';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { Actor, FeatureId, FeatureState, Instant, Json } from '@ueberblick/core/model';
import { actorValue } from '@ueberblick/core/perms';
import { featureAccess } from '@ueberblick/core/plan';
import type { Facts } from '@ueberblick/core/ports';

export interface ViewPassDeps {
  readonly facts: Pick<Facts, 'feature' | 'near' | 'ofType' | 'edgesFrom' | 'edgesTo' | 'history'>;
  readonly config: CompiledConfig;
  readonly actor: Actor;
  readonly geo: Geo;
  readonly now: () => Instant;
}

/** Whether a feature passes the compiled filter at `filter` (a key path); no filter accepts, a missing one rejects. */
export function viewPass(
  deps: ViewPassDeps,
): (state: FeatureState, s: { readonly filter: string | undefined }) => boolean {
  const { config } = deps;
  const base = featureAccess(deps.facts as Facts, config);
  const vars = new Map<string, never>([
    ['self', undefined as never],
    ['actor', actorValue(deps.actor) as never],
  ]);
  let current: FeatureId | undefined;
  const seen = new Map<FeatureId, Map<string, Json | undefined>>();
  const features: FeatureAccess = {
    ...base,
    property(id, key) {
      if (id === current) return base.property(id, key);
      let byKey = seen.get(id);
      if (byKey === undefined) seen.set(id, (byKey = new Map()));
      if (byKey.has(key)) return byKey.get(key);
      const v = base.property(id, key);
      byKey.set(key, v);
      return v;
    },
  };
  const ctx: EvalContext = { vars, features, now: deps.now(), relations: config.relations, geo: deps.geo };
  const compiledOf = new Map<string, ReturnType<typeof config.expressions.get>>();
  return (state, s) => {
    if (s.filter === undefined) return true;
    let compiled = compiledOf.get(s.filter);
    if (compiled === undefined) {
      compiled = config.expressions.get(s.filter);
      compiledOf.set(s.filter, compiled);
    }
    if (compiled === undefined) return false;
    current = state.id;
    vars.set('self', { $feature: state.id } as never);
    return condition(compiled.typed, ctx).value;
  };
}
