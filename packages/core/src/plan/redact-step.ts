/**
 * The `redact` then-step (B-005): resolve which (feature, property) pairs hold the subject's personal values, then
 * let `planRedaction` plan the null observations and the purge list. The subject kinds are the registry
 * `PERSONAL_SUBJECT_KINDS`; the pairs come from the config's `personal: { subject }` flags and from `Facts`.
 * Refusals name codes and paths, never a submitted value (a refusal is stored and survives an erasure).
 */
import type { FeatureId, Json, Key, Observation, Refusal, Run } from '../model';
import type { ThenStep } from '../schema/task';
import { kp } from '../schema/compile/kp';
import { planRedaction, type RedactPair } from './redact';
import { refuse, type Env } from './scope';

export type RedactOutcome =
  | {
      readonly ok: true;
      readonly observations: readonly Observation[];
      readonly purge: readonly RedactPair[];
      /** The subject id for `erasure_subjects`: a participant id, or a feature id. */
      readonly subject: string;
    }
  | { readonly ok: false; readonly refusal: Refusal };

type RedactStep = NonNullable<ThenStep['redact']>;

const bad = (message: string, path: string): RedactOutcome => ({
  ok: false,
  refusal: refuse('invalid_input', message, path),
});

/** The personal properties of `type` whose subject is exactly `subject` (`actor`, `feature` or `property:<key>`). */
function personalOf(env: Env, type: string, subject: string): string[] {
  const props = env.config.file.types?.[type]?.properties ?? {};
  return Object.entries(props)
    .filter(([, p]) => p.personal?.subject === subject)
    .map(([k]) => k);
}

function pairsOf(
  env: Env,
  kind: string,
  step: RedactStep,
  id: string,
): { pairs: RedactPair[] } | { refusal: string } {
  const pairs: RedactPair[] = [];
  if (kind === 'actor') {
    for (const o of env.overlay.observationsByActor(id)) {
      const type = env.overlay.feature(o.featureId)?.type;
      if (type !== undefined && personalOf(env, type, 'actor').includes(o.property))
        pairs.push({ featureId: o.featureId, property: o.property });
    }
  } else if (kind === 'property') {
    const key = step.subject.slice('property:'.length);
    for (const type of Object.keys(env.config.file.types ?? {})) {
      const props = personalOf(env, type, step.subject);
      if (props.length === 0) continue;
      for (const f of env.overlay.featuresWith(type as Key, key, id))
        for (const property of props) pairs.push({ featureId: f.id, property });
    }
  } else {
    const type = env.overlay.feature(id as FeatureId)?.type;
    if (type === undefined) return { refusal: 'the feature to erase does not exist' };
    for (const property of personalOf(env, type, 'feature'))
      pairs.push({ featureId: id as FeatureId, property });
  }
  return { pairs };
}

/** `id` is what `of` evaluated to (a feature counts as its id), or the task feature when `of` is absent. */
export function redactStep(
  env: Env,
  run: Run,
  step: RedactStep,
  index: number,
  id: Json | undefined,
): RedactOutcome {
  const path = kp('tasks', run.task, 'then', index, 'redact');
  const kind = step.subject.split(':')[0] as string;
  if (typeof id !== 'string' || id === '') {
    const what = kind === 'feature' ? 'a feature' : 'a participant id';
    return bad(`step ${index}: 'of' must give ${what}`, `${path}.of`);
  }
  const found = pairsOf(env, kind, step, id);
  if ('refusal' in found) return bad(`step ${index}: ${found.refusal}`, `${path}.of`);
  const plan = planRedaction({
    pairs: found.pairs,
    ...(run.clientTime !== undefined ? { phenomenonTime: run.clientTime } : {}),
  });
  return { ok: true, observations: plan.observations, purge: plan.purge, subject: id };
}
