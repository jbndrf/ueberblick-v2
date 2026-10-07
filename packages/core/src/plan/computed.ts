/**
 * Computed properties in plan (WP-312, `properties.<p>.computed`). After a run's observations are known, every computed
 * property of a touched feature whose inputs include a changed key (all of them on create) is evaluated in dependency
 * order, and an observation is appended to the same run when the value differs. The same code runs on the device
 * (prediction) and on the server, so the value is in the history like every other change (R3).
 *
 * `$recompute` (registry `SYSTEM_TASKS`) is the system run a deploy starts per feature when `computed` was added or
 * changed: it evaluates every computed property of one feature. Permissions do not apply to computed writes: the actor
 * changed an input, plan keeps the dependent value true.
 */
import { evaluate } from '../expr/evaluate';
import { sameJson } from '../form';
import type { FeatureId, Observation, Refusal, Run } from '../model';
import { keepsValues } from '../registry/lifecycle';
import { computedReads, orderComputed } from '../schema/compile/computed-inputs';
import type { CompiledConfig } from '../schema/compile/contract';
import { kp } from '../schema/compile/kp';
import type { PlannedRun } from './contract';
import type { Change } from './overlay';
import { envAt } from './resolve';
import { storable, toJson } from './steps';
import { compiled, evalContext, ref, refuse, type Env } from './scope';

interface ComputedProperty {
  readonly property: string;
  readonly path: string;
  /** The `self` fields the expression reads; a change of one of them makes the value stale. */
  readonly inputs: ReadonlySet<string>;
}

/** The computed properties of each type, in the order that computes a property after the ones it reads. */
type ComputedIndex = ReadonlyMap<string, readonly ComputedProperty[]>;

const indexes = new WeakMap<CompiledConfig, ComputedIndex>();

/** Derived from the compiled expressions once per config and never stored (compile guarantees there is no cycle). */
function computedIndex(config: CompiledConfig): ComputedIndex {
  const cached = indexes.get(config);
  if (cached !== undefined) return cached;
  const out = new Map<string, readonly ComputedProperty[]>();
  for (const [tk, type] of Object.entries(config.file.types ?? {})) {
    const props = new Map<string, ComputedProperty>();
    for (const [pk, p] of Object.entries(type.properties)) {
      if (p.computed === undefined) continue;
      const path = kp('types', tk, 'properties', pk, 'computed');
      const ast = config.expressions.get(path)?.typed.ast;
      if (ast !== undefined) props.set(pk, { property: pk, path, inputs: computedReads(ast).fields });
    }
    if (props.size === 0) continue;
    const { order } = orderComputed(new Map([...props].map(([k, v]) => [k, v.inputs])));
    out.set(
      tk,
      order.map((k) => props.get(k) as ComputedProperty),
    );
  }
  indexes.set(config, out);
  return out;
}

/** What a run touched on one feature: the observed keys, or every key (a created feature, `$recompute`). */
export type Touched = ReadonlySet<string> | 'all';

/** The features a run wrote and the keys it wrote on each; the `created` feature has every key touched. */
function touchedBy(
  observations: readonly Observation[],
  created: FeatureId | undefined,
): ReadonlyMap<FeatureId, Touched> {
  const keys = new Map<FeatureId, Set<string>>();
  for (const o of observations) {
    const set = keys.get(o.featureId) ?? new Set<string>();
    set.add(o.property);
    keys.set(o.featureId, set);
  }
  const out = new Map<FeatureId, Touched>(keys);
  if (created !== undefined) out.set(created, 'all');
  return out;
}

/** After a run: recomputes what its observations made stale. Nothing is allocated for a project without computed properties. */
export function recomputeAfter(
  env: Env,
  run: Run,
  observations: readonly Observation[],
  created: FeatureId | undefined,
): Recomputed {
  if (computedIndex(env.config).size === 0) return { observations: [], changes: [] };
  return recompute(env, run, touchedBy(observations, created));
}

export interface Recomputed {
  readonly observations: readonly Observation[];
  readonly changes: readonly Change[];
}

/** Recomputes the stale computed properties of each touched feature and applies the new values to the overlay. */
export function recompute(env: Env, run: Run, touched: ReadonlyMap<FeatureId, Touched>): Recomputed {
  const observations: Observation[] = [];
  const changes: Change[] = [];
  for (const [id, keys] of touched) {
    // Each touched feature is recomputed under its own version (A-029 §2).
    const at = envAt(env, id);
    const index = computedIndex(at.config);
    if (index.size === 0) continue;
    const type = env.overlay.feature(id)?.type;
    const props = type === undefined ? undefined : index.get(type);
    if (type === undefined || props === undefined) continue;
    const dirty = keys === 'all' ? undefined : new Set(keys);
    const ctx = evalContext(at, run.actor, new Map([['self', ref(id)]]));
    for (const c of props) {
      if (dirty !== undefined && ![...c.inputs].some((f) => dirty.has(f))) continue;
      const r = evaluate(compiled(at.config, c.path), ctx);
      // Evaluation is total: a value that cannot be computed (an input is empty) clears the property, never leaves a stale one.
      const value = r.ok ? storable(env, id, type, c.property, toJson(r.value)) : null;
      const current = env.overlay.feature(id)?.properties[c.property];
      if (sameJson(value, current) || (value === null && current === undefined)) continue;
      const obs: Observation = {
        featureId: id,
        property: c.property,
        result: value,
        ...(run.clientTime === undefined ? {} : { phenomenonTime: run.clientTime }),
      };
      observations.push(obs);
      changes.push(...env.overlay.apply(run.id, [obs]));
      dirty?.add(c.property);
    }
  }
  return { observations, changes };
}

export type RecomputeOutcome =
  | { readonly ok: true; readonly runs: readonly PlannedRun[] }
  | { readonly ok: false; readonly refusal: Refusal };

/**
 * `$recompute`: the system run that brings every computed property of `run.featureId` up to date. It is idempotent:
 * a feature whose values are current gets no observations and the run is still accepted, so a restarted executor
 * never writes twice. Input: none.
 */
export function planRecompute(env: Env, run: Run): RecomputeOutcome {
  if (run.actor.kind !== 'system')
    return { ok: false, refusal: refuse('not_permitted', `only the system may run '${run.task}'`, 'actor') };
  const feature = run.featureId === undefined ? undefined : env.overlay.feature(run.featureId);
  if (run.featureId === undefined || feature === undefined)
    return { ok: false, refusal: refuse('unknown_feature', `'${run.task}' needs an existing feature`) };
  // A feature that was deleted while the executor ran has nothing left to compute.
  const observations = keepsValues(feature.lifecycle)
    ? recompute(env, run, new Map([[run.featureId, 'all']])).observations
    : [];
  return { ok: true, runs: [{ run, observations, created: [], purge: [], erased: [] }] };
}
