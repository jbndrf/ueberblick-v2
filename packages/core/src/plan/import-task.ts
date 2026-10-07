/**
 * `$import` (WP-363, registry `SYSTEM_TASKS`): one imported feature. It plans the named creating task exactly as a
 * normal run (form, then steps, computed values, defaults, process start, rules), then writes `constants` as further
 * observations of the created feature, so a constant overrides the task's own value for that property, the stage
 * included ('In Stufe importieren'). Every constant goes through the check `$seed` uses (`valueRefusal`): an unknown
 * property, a system key or a value that does not fit is refused. Only the `import` actor may run it. The stored run is
 * the `$import` run itself (its input says what was asked); the observations are the creating task's plus the constants.
 *
 * Input: `{ task, values, constants }`.
 */
import { isEmptyValue } from '../form/empty';
import type { Json, Key, Observation, Refusal, Run } from '../model';
import type { PlannedRun } from './contract';
import { planRun } from './run';
import { refuse, type Env } from './scope';
import { valueRefusal } from './values';

export type ImportTaskOutcome =
  | { readonly ok: true; readonly runs: readonly PlannedRun[] }
  | { readonly ok: false; readonly refusal: Refusal };

const bad = (message: string, path: string): ImportTaskOutcome => ({
  ok: false,
  refusal: refuse('invalid_input', message, path),
});

const isObject = (v: Json | undefined): v is { readonly [k: string]: Json } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function planImportTask(env: Env, run: Run): ImportTaskOutcome {
  if (run.actor.kind !== 'import')
    return { ok: false, refusal: refuse('not_permitted', `only an import may run '${run.task}'`, 'actor') };
  const { task, values, constants } = run.input;
  if (typeof task !== 'string') return bad("'task' is missing", 'input.task');
  if (!isObject(values)) return bad("'values' is missing", 'input.values');
  if (!isObject(constants)) return bad("'constants' is missing", 'input.constants');
  const creates = env.config.file.tasks?.[task as Key]?.creates;
  const declared = creates === undefined ? undefined : env.config.file.types?.[creates as Key];
  if (creates === undefined || declared === undefined)
    return bad(`'${task}' is not a task that creates a feature`, 'input.task');
  for (const [key, value] of Object.entries(constants)) {
    const refusal = valueRefusal(declared, creates, key, value, `input.constants.${key}`);
    if (refusal !== undefined) return { ok: false, refusal };
  }

  const inner = planRun(env, { ...run, task: task as Key, input: values }, 0);
  if (!inner.ok) return inner;
  const [main, ...chained] = inner.runs;
  const id = main?.created[0];
  if (main === undefined || id === undefined) return bad(`'${task}' created no feature`, 'input.task');
  const extra: Observation[] = Object.entries(constants)
    .filter(([, value]) => !isEmptyValue(value))
    .map(([property, result]) => ({
      featureId: id,
      property,
      result,
      ...(run.clientTime === undefined ? {} : { phenomenonTime: run.clientTime }),
    }));
  env.overlay.apply(run.id, extra);
  return {
    ok: true,
    runs: [{ ...main, run, observations: [...main.observations, ...extra] }, ...chained],
  };
}
