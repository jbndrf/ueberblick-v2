/**
 * The `condition` of `createDerivedLookup` for one config (R1): a derived relation whose `derive:` is more than a
 * predicate is one compiled expression, evaluated with `self` and `other` bound. The run transaction
 * (`store/run/projection.ts`) and `createDeriveFor` both take it from here.
 */
import {
  featureAccess,
  type Clock,
  type CompiledConfig,
  type DerivedLookup,
  type Facts,
  type Geo,
} from '@ueberblick/core';
import { condition, type EvalContext } from '@ueberblick/core/expr';

export interface DerivedConditionDeps {
  readonly geo: Geo;
  readonly clock: Clock;
}

export function derivedCondition(
  config: CompiledConfig,
  facts: Facts,
  deps: DerivedConditionDeps,
): DerivedLookup['condition'] {
  const features = featureAccess(facts, config);
  return (path, self, other) => {
    const typed = config.expressions.get(path)?.typed;
    if (typed === undefined) return false;
    const ctx: EvalContext = {
      vars: new Map([
        ['self', { $feature: self.id }],
        ['other', { $feature: other.id }],
      ]),
      features,
      now: deps.clock.now(),
      relations: config.relations,
      geo: deps.geo,
    };
    return condition(typed, ctx).value;
  };
}
