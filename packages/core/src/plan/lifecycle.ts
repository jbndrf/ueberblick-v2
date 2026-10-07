/** The `lifecycle` then step (A-028 item 2): who may set which state. */
import type { EvalContext } from '../expr/contract';
import type { FeatureId, Refusal } from '../model';
import type { LifecycleState } from '../registry/lifecycle';
import { isBound, refuse } from './scope';
import type { StepInput } from './steps';

/** Setting `deleted` needs `permissions.delete` for a bound actor; every other state follows task availability. */
export function lifecycleStep(
  s: StepInput,
  ctx: EvalContext,
  id: FeatureId,
  state: LifecycleState,
  /** An `of` target (A-035): the refusal names the feature and points at its type's delete permission. */
  target = false,
): Refusal | undefined {
  if (state !== 'deleted' || !isBound(s.run.actor)) return undefined;
  const feature = s.env.overlay.feature(id);
  if (feature === undefined) return undefined;
  const d = s.env.perms.forType(feature.type)?.canDelete(s.env.perms.subjects(s.run.actor), feature, ctx);
  if (d !== undefined && d.ok) return undefined;
  if (target)
    return refuse(
      'not_permitted',
      `the actor may not delete ${feature.type} ${id}`,
      `types.${feature.type}.permissions.delete`,
    );
  return refuse('not_permitted', `the actor may not delete ${feature.type}`, 'permissions.delete');
}
