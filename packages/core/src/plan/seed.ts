/**
 * `$seed` (WP-342, registry `SYSTEM_TASKS`): the built-in task that creates one demo feature of a type with any
 * declared property values, the process stage and the geometry included (a creating task cannot set the stage: plan
 * writes the process `start`). Only the `system` actor may run it, and it writes ordinary observations (R3). Every
 * value is checked against its property (`typeFits`), so a stage that is no option is refused. Rules do not fire and
 * permissions do not apply: the preview seeds data, nobody acts. A property without a value gets its `default`, the
 * process property its `start`.
 *
 * Input: `{ type, values }`. The feature id is `run.featureId` or a fresh one from the ports.
 */
import type { FeatureId, Json, Key, Observation, Refusal, Run } from '../model';
import { isEmptyValue } from '../form/empty';
import { processesOf } from '../process';
import type { PlannedRun } from './contract';
import { claimId, refuse, type Env } from './scope';
import { valueRefusal } from './values';

export type SeedOutcome =
  | { readonly ok: true; readonly runs: readonly PlannedRun[] }
  | { readonly ok: false; readonly refusal: Refusal };

const bad = (message: string, path = 'input'): SeedOutcome => ({
  ok: false,
  refusal: refuse('invalid_input', message, path),
});

export function planSeed(run: Run, env: Env): SeedOutcome {
  const { config } = env;
  if (run.actor.kind !== 'system')
    return {
      ok: false,
      refusal: refuse('not_permitted', `only the system may run '${run.task}'`, 'actor'),
    };
  const { type, values } = run.input;
  if (typeof type !== 'string') return bad("'type' is missing", 'input.type');
  const declared = config.file.types?.[type as Key];
  if (declared === undefined) return bad(`'${type}' is not a type`, 'input.type');
  if (typeof values !== 'object' || values === null || Array.isArray(values))
    return bad("'values' is missing", 'input.values');
  const given = values as { readonly [k: string]: Json };
  const id = (run.featureId ?? env.ids.featureId()) as FeatureId;
  const taken = claimId(env, id, 'featureId');
  if (taken !== undefined) return { ok: false, refusal: taken };
  const out: Observation[] = [{ featureId: id, property: '$type', result: type }];
  const written = new Set<string>();
  const put = (property: string, result: Json): void => {
    out.push({ featureId: id, property, result });
    written.add(property);
  };
  for (const [key, value] of Object.entries(given)) {
    const refusal = valueRefusal(declared, type, key, value, `input.values.${key}`);
    if (refusal !== undefined) return { ok: false, refusal };
    if (!isEmptyValue(value)) put(key, value);
  }
  for (const proc of processesOf(declared)) if (!written.has(proc.property)) put(proc.property, proc.start);
  for (const [key, p] of Object.entries(declared.properties))
    if (p.default !== undefined && !written.has(key)) put(key, p.default);
  return { ok: true, runs: [{ run, observations: out, created: [id], purge: [], erased: [] }] };
}
