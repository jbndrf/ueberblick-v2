/**
 * The creation quota of a role (WP-639, v3's `roles.max_instances`): a participant may create at most `quota`
 * features, all types together; the highest quota among their roles counts, and no quota on any role means no limit.
 * It is a planner refusal, so the device (which predicts runs with the same `plan`) and the server agree (R1).
 *
 * Cost: one `Facts.createdBy(actor, quota)`, which stops counting at `quota`, so it is bounded by the quota and never
 * scans the features (R14). Only a participant whose role carries a quota pays it. The features created earlier in the
 * same batch are counted from `Env.created`, since the facts do not hold them yet.
 */
import type { Actor, Refusal } from '../model';
import { refuse, type Env } from './scope';

/** The quota among `roles` of a project file (the highest wins), or `undefined` when none of them has one. */
export function quotaOfRoles(
  file: { readonly roles?: Readonly<Record<string, { readonly quota?: number | undefined }>> | undefined },
  roles: readonly string[],
): number | undefined {
  let best: number | undefined;
  for (const role of roles) {
    const q = file.roles?.[role]?.quota;
    if (q !== undefined && (best === undefined || q > best)) best = q;
  }
  return best;
}

/** The quota that applies to `actor`, or `undefined` when none of their roles has one. */
export const quotaOf = (env: Env, actor: Actor): number | undefined =>
  quotaOfRoles(env.config.file, actor.roles);

/** A refusal when this creation would exceed the actor's quota. */
export function checkQuota(env: Env, actor: Actor): Refusal | undefined {
  const quota = quotaOf(env, actor);
  if (quota === undefined) return undefined;
  const inBatch = env.created.get(actor.id) ?? 0;
  const used = inBatch + env.ports.facts.createdBy(actor.id, quota - inBatch);
  return used >= quota
    ? refuse(
        'quota_exceeded',
        `the actor may create at most ${quota} features and already created ${used}`,
        'quota',
      )
    : undefined;
}

/** Counts a creation that was accepted into the batch. */
export function recordCreated(env: Env, actor: Actor): void {
  env.created.set(actor.id, (env.created.get(actor.id) ?? 0) + 1);
}
