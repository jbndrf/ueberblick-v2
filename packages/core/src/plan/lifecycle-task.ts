/**
 * `$lifecycle` (WP-363, registry `SYSTEM_TASKS`): sets the system lifecycle of one feature, writing the reserved key
 * `$lifecycle` as the `lifecycle` then step does (`steps.ts`). Only the `system`, `import` and `admin` actors may run it; all
 * are unbound, so the `permissions.delete` check of `lifecycleStep` never applies to them. The import uses it to
 * retire the old features when it replaces them; an admin uses it to delete a row of a Tabelle (WP-382). Idempotent. Input `{ state }` (registry `LIFECYCLE_STATES`); the
 * feature is `run.featureId`.
 */
import { RESERVED_LIFECYCLE } from '../fold/state';
import type { FeatureId, Refusal, Run } from '../model';
import type { Facts } from '../ports';
import { LIFECYCLE_STATES } from '../registry/lifecycle';
import type { PlannedRun } from './contract';
import { refuse } from './scope';

export type LifecycleTaskOutcome =
  | { readonly ok: true; readonly runs: readonly PlannedRun[] }
  | { readonly ok: false; readonly refusal: Refusal };

export function planLifecycleTask(run: Run, facts: Facts): LifecycleTaskOutcome {
  if (run.actor.kind !== 'system' && run.actor.kind !== 'import' && run.actor.kind !== 'admin')
    return {
      ok: false,
      refusal: refuse(
        'not_permitted',
        `only the system, an import or an admin may run '${run.task}'`,
        'actor',
      ),
    };
  const id = run.featureId as FeatureId | undefined;
  const feature = id === undefined ? undefined : facts.feature(id);
  if (id === undefined || feature === undefined)
    return { ok: false, refusal: refuse('unknown_feature', `'${run.task}' needs an existing feature`) };
  const state = run.input['state'];
  if (typeof state !== 'string' || !LIFECYCLE_STATES.entries.some((e) => e.key === state))
    return {
      ok: false,
      refusal: refuse('invalid_input', "'state' must be a lifecycle state", 'input.state'),
    };
  return {
    ok: true,
    runs: [
      {
        run,
        observations:
          feature.lifecycle === state ? [] : [{ featureId: id, property: RESERVED_LIFECYCLE, result: state }],
        created: [],
        purge: [],
        erased: [],
      },
    ],
  };
}
