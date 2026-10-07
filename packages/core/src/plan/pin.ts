/**
 * `$pin` (WP-317, registry `SYSTEM_TASKS`, A-029): the built-in task a deploy uses to pin one feature to a config
 * version, so it keeps its tasks, forms and stages while the deployed version moves on. Only the `system` actor may run
 * it. It writes the reserved key `$version` as an ordinary observation (R3), so history shows it. Input `{ version }`:
 * an integer pins, `null` unpins (the feature floats on the deployed version again; the manual move of P3 uses it).
 * Idempotent: a feature that already has that pin gets no observation and the run is still accepted.
 */
import type { Facts } from '../ports';
import type { FeatureId, Observation, Refusal, Run } from '../model';
import type { PlannedRun } from './contract';
import { refuse } from './scope';

export type PinOutcome =
  | { readonly ok: true; readonly runs: readonly PlannedRun[] }
  | { readonly ok: false; readonly refusal: Refusal };

export function planPin(run: Run, facts: Facts): PinOutcome {
  if (run.actor.kind !== 'system')
    return {
      ok: false,
      refusal: refuse('not_permitted', `only the system may run '${run.task}'`, 'actor'),
    };
  const id = run.featureId as FeatureId | undefined;
  const feature = id === undefined ? undefined : facts.feature(id);
  if (id === undefined || feature === undefined)
    return { ok: false, refusal: refuse('unknown_feature', `'${run.task}' needs an existing feature`) };
  const version = run.input['version'];
  if (version !== null && !(typeof version === 'number' && Number.isInteger(version) && version >= 1))
    return {
      ok: false,
      refusal: refuse(
        'invalid_input',
        "'version' must be a config version number, or null to unpin",
        'input',
      ),
    };
  const same = (feature.pinnedVersion ?? null) === version;
  const observations: readonly Observation[] = same
    ? []
    : [{ featureId: id, property: '$version', result: version }];
  return { ok: true, runs: [{ run, observations, created: [], purge: [], erased: [] }] };
}
