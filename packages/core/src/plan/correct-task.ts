/**
 * `$correct` (WP-370, registry `SYSTEM_TASKS`): 'Admin-Korrektur', the admin's way to fix a wrong value of one feature
 * (v3's Bearbeitungsmodus on the data page). Only the `admin` actor may run it, so no role check applies. Input
 * `{ values: { <property>: value }, expected_seq? }` on `run.featureId` (`expected_seq` must equal the feature's current seq, else `not_available` at `input.expected_seq`); one run writes every changed value.
 *
 * Every value goes through the check `$seed` and `$import` use (`valueRefusal`, R1). The process (stage) property is
 * refused: a stage moves through tasks, so its rules and steps run (owner answer A1). A value equal to the current one
 * writes nothing; an empty one clears the property with an explicit null. The run is planned as any other: computed
 * values follow in the same run and the rules of the changed properties fire (`<type>.<property>`, `<type>.*`).
 */
import { sameJson } from '../form';
import { isEmptyValue } from '../form/empty';
import type { FeatureId, Json, Key, Observation, Refusal, Run } from '../model';
import { processesOf } from '../process';
import { recomputeAfter } from './computed';
import type { PlannedRun } from './contract';
import { fireRules } from './rules';
import { envAt } from './resolve';
import { planRun } from './run';
import { refuse, type Env } from './scope';
import { valueRefusal } from './values';

export type CorrectOutcome =
  | { readonly ok: true; readonly runs: readonly PlannedRun[] }
  | { readonly ok: false; readonly refusal: Refusal };

const bad = (message: string, path: string): CorrectOutcome => ({
  ok: false,
  refusal: refuse('invalid_input', message, path),
});

export function planCorrect(base: Env, run: Run): CorrectOutcome {
  if (run.actor.kind !== 'admin')
    return { ok: false, refusal: refuse('not_permitted', `only an admin may run '${run.task}'`, 'actor') };
  const id = run.featureId as FeatureId | undefined;
  const env = envAt(base, id);
  const feature = id === undefined ? undefined : env.overlay.feature(id);
  if (id === undefined || feature === undefined)
    return { ok: false, refusal: refuse('unknown_feature', `'${run.task}' needs an existing feature`) };
  const values = run.input['values'];
  if (typeof values !== 'object' || values === null || Array.isArray(values))
    return bad("'values' is missing", 'input.values');
  // The stale check runs here, inside the run's transaction, so a second writer cannot interleave (WP-370 round 1).
  const expected = run.input['expected_seq'];
  if (expected !== undefined) {
    if (typeof expected !== 'number' || !Number.isInteger(expected))
      return bad("'expected_seq' must be an integer", 'input.expected_seq');
    if (expected !== feature.updatedSeq)
      return {
        ok: false,
        refusal: refuse('not_available', 'the feature changed since it was read', 'input.expected_seq'),
      };
  }
  const entries = Object.entries(values as { readonly [k: string]: Json });
  if (entries.length === 0) return bad("'values' is empty", 'input.values');
  const declared = env.config.file.types?.[feature.type as Key];
  if (declared === undefined)
    return { ok: false, refusal: refuse('unknown_feature', `'${feature.type}' is not a type`) };
  const stages = new Set<string>(processesOf(declared).map((p) => p.property));

  const initial: Observation[] = [];
  for (const [key, value] of entries) {
    const path = `input.values.${key}`;
    if (stages.has(key))
      return {
        ok: false,
        refusal: refuse('not_permitted', `'${key}' is the stage; it changes through tasks`, path),
      };
    const refusal = valueRefusal(declared, feature.type, key, value, path);
    if (refusal !== undefined) return { ok: false, refusal };
    const current = feature.properties[key];
    const result = isEmptyValue(value) ? null : value;
    if (result === null ? isEmptyValue(current as Json | undefined) : sameJson(result, current)) continue;
    initial.push({
      featureId: id,
      property: key,
      result,
      ...(run.clientTime === undefined ? {} : { phenomenonTime: run.clientTime }),
    });
  }

  const changes = [...env.overlay.apply(run.id, initial)];
  const computed = recomputeAfter(env, run, initial, undefined);
  changes.push(...computed.changes);
  const planned: PlannedRun = {
    run,
    observations: [...initial, ...computed.observations],
    created: [],
    purge: [],
    erased: [],
  };
  const chain = fireRules(
    env,
    { run, task: run.task, subject: id, form: {}, changes, created: [], depth: 0 },
    planRun,
  );
  if (!chain.ok) return chain;
  return { ok: true, runs: [planned, ...chain.runs] };
}
