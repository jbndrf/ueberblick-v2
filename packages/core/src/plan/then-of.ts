/**
 * The `of` of a `set` or `lifecycle` then-step (A-035): the features the step acts on instead of the task
 * subject. One CEL expression (R5) that yields a feature or a list of them, read through the facts the
 * expression already uses (a relation is an edge lookup, never a scan of all features).
 */
import { evaluate } from '../expr/evaluate';
import type { EvalContext } from '../expr/contract';
import type { FeatureId, Key, Refusal } from '../model';
import { THEN_STEP_TARGETS_MAX } from '../registry/limits';
import { kp } from '../schema/compile/kp';
import { compiled, refuse } from './scope';
import type { StepInput } from './steps';
import { liveAndVisible } from './targets';

export interface Target {
  readonly id: FeatureId;
  readonly type: Key;
}

export type Targets =
  | { readonly ok: true; readonly targets: readonly Target[] }
  | { readonly ok: false; readonly refusal: Refusal };

/** Evaluates step `index`'s `of` to distinct, existing features (at most THEN_STEP_TARGETS_MAX). */
export function resolveTargets(s: StepInput, ctx: EvalContext, index: number): Targets {
  const path = kp('tasks', s.run.task, 'then', index, 'of');
  const bad = (message: string, code: 'invalid_input' | 'too_many_targets' = 'invalid_input'): Targets => ({
    ok: false,
    refusal: refuse(code, message, path),
  });
  const r = evaluate(compiled(s.env.config, path), ctx);
  if (!r.ok) return bad(`step ${index}: ${r.error.message}`);
  const values = Array.isArray(r.value) ? r.value : r.value === null ? [] : [r.value];
  if (values.length > THEN_STEP_TARGETS_MAX) {
    return bad(
      `step ${index} acts on ${values.length} features, at most ${THEN_STEP_TARGETS_MAX} are allowed`,
      'too_many_targets',
    );
  }
  const seen = new Set<FeatureId>();
  const targets: Target[] = [];
  for (const v of values) {
    if (v === null || typeof v !== 'object' || Array.isArray(v) || !('$feature' in v))
      return bad(`step ${index}: \`of\` must name features`);
    const id = v.$feature as FeatureId;
    if (seen.has(id)) continue;
    seen.add(id);
    const feature = s.env.overlay.feature(id);
    if (feature === undefined) return bad(`step ${index}: feature ${id} is gone`);
    const unreachable = liveAndVisible(s.env, s.run.actor, id, path);
    if (unreachable !== undefined) return { ok: false, refusal: unreachable };
    targets.push({ id, type: feature.type });
  }
  return { ok: true, targets };
}
