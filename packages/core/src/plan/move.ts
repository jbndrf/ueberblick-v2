/**
 * `$move` (WP-307, registry `SYSTEM_TASKS`): the built-in task a deploy uses to move one feature's value after a
 * `{ to }` mapping. Only the `system` actor may run it, and it writes ordinary observations on the feature (R3), so
 * history shows it like every run. It is idempotent: a feature that no longer holds the `from` value gets no
 * observations and the run is still accepted, so an executor that is killed and restarted never moves a value twice.
 *
 * Input: `{ property, from, to }` moves an option (a select value, or one entry of a multiselect list) and
 * `{ property, to_property }` moves a property's value to another property of the same feature (it keeps a value the
 * new property already holds). Rules do not fire: a move is a migration of stored values, not a user event.
 */
import type { Facts } from '../ports';
import { keepsValues } from '../registry/lifecycle';
import type { FeatureId, Json, Key, Observation, Refusal, Run } from '../model';
import type { CompiledConfig } from '../schema/compile/contract';
import type { PlannedRun } from './contract';
import { refuse } from './scope';

export type MoveOutcome =
  | { readonly ok: true; readonly runs: readonly PlannedRun[] }
  | { readonly ok: false; readonly refusal: Refusal };

const bad = (message: string): MoveOutcome => ({
  ok: false,
  refusal: refuse('invalid_input', message, 'input'),
});
const done = (run: Run, observations: readonly Observation[]): MoveOutcome => ({
  ok: true,
  runs: [{ run, observations, created: [], purge: [], erased: [] }],
});

const isText = (v: Json | undefined): v is string => typeof v === 'string' && v !== '';
const isEmpty = (v: Json | undefined): boolean => v === undefined || v === null || v === '';

/** The list with every `from` replaced by `to` once, in place, without a duplicate; `undefined` when `from` is absent. */
function replaceIn(list: readonly Json[], from: string, to: string): readonly Json[] | undefined {
  if (!list.includes(from)) return undefined;
  const out: Json[] = [];
  for (const v of list) {
    const w = v === from ? to : v;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

export function planMove(run: Run, facts: Facts, config: CompiledConfig): MoveOutcome {
  if (run.actor.kind !== 'system')
    return {
      ok: false,
      refusal: refuse('not_permitted', `only the system may run '${run.task}'`, 'actor'),
    };
  const id = run.featureId as FeatureId | undefined;
  const feature = id === undefined ? undefined : facts.feature(id);
  if (id === undefined || feature === undefined)
    return { ok: false, refusal: refuse('unknown_feature', `'${run.task}' needs an existing feature`) };

  const { property, from, to, to_property: toProperty } = run.input;
  if (!isText(property)) return bad("'property' is missing");
  const declared = config.file.types?.[feature.type as Key]?.properties ?? {};
  // A feature that was deleted while the executor ran has nothing left to move.
  if (!keepsValues(feature.lifecycle)) return done(run, []);
  const value = feature.properties[property];

  if (toProperty !== undefined) {
    // The source property is gone from the new version by definition; only the target must exist.
    if (!isText(toProperty) || declared[toProperty] === undefined)
      return bad(`'${String(toProperty)}' is not a property of ${feature.type}`);
    if (isEmpty(value) || !isEmpty(feature.properties[toProperty])) return done(run, []);
    return done(run, [{ featureId: id, property: toProperty, result: value as Json }]);
  }

  const own = declared[property];
  if (own === undefined) return bad(`'${property}' is not a property of ${feature.type}`);
  if (!isText(from) || !isText(to)) return bad("'from' and 'to' are required");
  if (own.type !== 'select' && own.type !== 'multiselect')
    return bad(`'${property}' is not a select or multiselect`);
  if (!Object.hasOwn(own.options ?? {}, to)) return bad(`'${to}' is not an option of '${property}'`);

  if (from === to) return done(run, []);
  if (own.type === 'select')
    return done(run, value === from ? [{ featureId: id, property, result: to }] : []);
  const next = Array.isArray(value) ? replaceIn(value, from, to) : undefined;
  return done(run, next === undefined ? [] : [{ featureId: id, property, result: next }]);
}
