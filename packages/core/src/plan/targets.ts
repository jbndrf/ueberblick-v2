/**
 * WP-755: the one place that decides whether a bound actor may point at, write to or act on an existing feature:
 * it must exist, be served (not archived or deleted), and pass `canSee`. Reference values must also be of the
 * relation's declared `to` type. Lookups are by id (R14); system, import and admin actors are unbound (`isBound`).
 */
import type { FeatureId, Json, Key, Refusal } from '../model';
import { isServed } from '../registry/lifecycle';
import { envAt } from './resolve';
import { evalContext, isBound, refuse, type Env } from './scope';
import type { Actor } from '../model';

/** A target an existing feature must be: served, and visible to a bound actor. */
export function liveAndVisible(env: Env, actor: Actor, id: FeatureId, path: string): Refusal | undefined {
  const feature = env.overlay.feature(id);
  if (feature === undefined) return refuse('unknown_feature', `feature ${id} does not exist`, path);
  if (!isServed(feature.lifecycle))
    return refuse('case_closed', `feature ${id} is ${feature.lifecycle}`, path);
  if (!isBound(actor)) return undefined;
  const seen = envAt(env, id)
    .perms.forType(feature.type)
    ?.canSee(env.perms.subjects(actor), feature, evalContext(env, actor, new Map()));
  return seen !== undefined && seen.ok
    ? undefined
    : refuse('not_permitted', `the actor may not see ${id}`, 'permissions.see');
}

const idsOf = (v: Json | undefined): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** The refusal for a reference `value` written to `property` of a `type` feature (`selfId`: allowed target while it is created). */
export function referenceFault(
  env: Env,
  actor: Actor,
  type: Key,
  property: string,
  value: Json,
  selfId: FeatureId | undefined,
): Refusal | undefined {
  const ref = env.config.foldTypes.get(type)?.references.find((r) => r.property === property);
  if (ref === undefined) return undefined;
  for (const id of idsOf(value)) {
    if (id === selfId) continue;
    const bad = liveAndVisible(env, actor, id as FeatureId, `properties.${property}`);
    if (bad !== undefined) return bad;
    const target = env.overlay.feature(id as FeatureId);
    if (target !== undefined && target.type !== ref.to)
      return refuse(
        'invalid_input',
        `${property} must name a ${ref.to}, not a ${target.type}`,
        `properties.${property}`,
      );
  }
  return undefined;
}
