/**
 * `$create` (WP-382, registry `SYSTEM_TASKS`): 'Admin-Anlage', an admin adds one feature of a type with values, the
 * way v3's table page added a row (`custom-tables/[tableId]/+page.svelte` "Zeile hinzufügen"). Only the `admin` actor
 * may run it, so no role check applies. Input `{ type, values }`; the feature id is `run.featureId` or a fresh one.
 *
 * Every value goes through the check `$seed`, `$import` and `$correct` share (`valueRefusal`, R1); the process (stage)
 * property is refused as in `$correct` (a stage starts at the process `start` and moves through tasks). A property
 * without a value gets its `default`; a `required` property still empty after that refuses the run (`required_missing`),
 * as for a creating task. Computed values follow in the same run. The run writes `$type` and `$created_by`, so the
 * audit columns show the admin. Rules do not fire: nobody acts on the map, an admin fills a list.
 */
import { isEmptyValue } from '../form/empty';
import { RESERVED_CREATED_BY, creatorOf } from '../fold/audit';
import type { FeatureId, Json, Key, Observation, Refusal, Run } from '../model';
import { processesOf } from '../process';
import { recomputeAfter } from './computed';
import type { PlannedRun } from './contract';
import { requiredMissing } from './run';
import { claimId, refuse, type Env } from './scope';
import { valueRefusal } from './values';

export type CreateOutcome =
  | { readonly ok: true; readonly runs: readonly PlannedRun[] }
  | { readonly ok: false; readonly refusal: Refusal };

const bad = (message: string, path: string): CreateOutcome => ({
  ok: false,
  refusal: refuse('invalid_input', message, path),
});

export function planCreate(env: Env, run: Run): CreateOutcome {
  if (run.actor.kind !== 'admin')
    return { ok: false, refusal: refuse('not_permitted', `only an admin may run '${run.task}'`, 'actor') };
  const { type, values } = run.input;
  if (typeof type !== 'string') return bad("'type' is missing", 'input.type');
  const declared = env.config.file.types?.[type as Key];
  if (declared === undefined) return bad(`'${type}' is not a type`, 'input.type');
  if (typeof values !== 'object' || values === null || Array.isArray(values))
    return bad("'values' is missing", 'input.values');
  const given = values as { readonly [k: string]: Json };
  const id = (run.featureId ?? env.ids.featureId()) as FeatureId;
  const taken = claimId(env, id, 'featureId');
  if (taken !== undefined) return { ok: false, refusal: taken };
  const stamp = run.clientTime === undefined ? {} : { phenomenonTime: run.clientTime };
  const stages = new Set<string>(processesOf(declared).map((p) => p.property));

  const initial: Observation[] = [
    { featureId: id, property: '$type', result: type, ...stamp },
    { featureId: id, property: RESERVED_CREATED_BY, result: creatorOf(run), ...stamp },
  ];
  const written = new Set<string>();
  for (const [key, value] of Object.entries(given)) {
    const path = `input.values.${key}`;
    if (stages.has(key))
      return {
        ok: false,
        refusal: refuse('not_permitted', `'${key}' is the stage; it starts at the process start`, path),
      };
    const refusal = valueRefusal(declared, type, key, value, path);
    if (refusal !== undefined) return { ok: false, refusal };
    if (isEmptyValue(value)) continue;
    initial.push({ featureId: id, property: key, result: value, ...stamp });
    written.add(key);
  }
  for (const [key, p] of Object.entries(declared.properties))
    if (p.default !== undefined && !written.has(key))
      initial.push({ featureId: id, property: key, result: p.default, ...stamp });
  for (const proc of processesOf(declared))
    initial.push({ featureId: id, property: proc.property, result: proc.start, ...stamp });

  const changes = [...env.overlay.apply(run.id, initial)];
  const computed = recomputeAfter(env, run, initial, id);
  changes.push(...computed.changes);
  const missing = requiredMissing(env, { id, type: type as Key });
  if (missing !== undefined) return { ok: false, refusal: missing };
  return {
    ok: true,
    runs: [
      {
        run,
        observations: [...initial, ...computed.observations],
        created: [id],
        purge: [],
        erased: [],
      },
    ],
  };
}
