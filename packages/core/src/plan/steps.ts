/**
 * `then` steps (docs/05): evaluated in order after the form is accepted, each step's writes visible to
 * the next. A `set` key is a property of the task's subject (the created feature, else `self`) or
 * `bind.property` on a declared bind. A string value is an expression, other scalars are literals (A-004 item 9).
 */
import { condition, evaluate } from '../expr/evaluate';
import type { EvalValue } from '../expr/contract';
import type { FeatureId, Json, Key, Observation, Run } from '../model';
import type { Refusal } from '../model';
import type { Task } from '../schema/task';
import { kp } from '../schema/compile/kp';
import type { Change } from './overlay';
import { RESERVED_LIFECYCLE } from '../fold/state';
import type { LifecycleState } from '../registry/lifecycle';
import { lifecycleStep } from './lifecycle';
import { resolveTargets, type Target } from './then-of';
import { redactStep } from './redact-step';
import type { RedactPair } from './redact';
import { envAt } from './resolve';
import { compiled, guardedContext, isBound, refuse, type Env } from './scope';
import { liveAndVisible, referenceFault } from './targets';

export interface StepInput {
  readonly env: Env;
  readonly run: Run;
  readonly task: Task;
  /** The feature unprefixed `set` keys address: the created feature, else `self` (absent for a task without either). */
  readonly subject: { readonly id: FeatureId; readonly type: Key } | undefined;
  /** `self` and the binds. */
  readonly vars: ReadonlyMap<string, EvalValue>;
  /** The values the run submitted (non-relevant fields dropped). */
  readonly form: { readonly [field: string]: Json };
  readonly created: boolean;
}

export type StepsResult =
  | {
      readonly ok: true;
      readonly observations: readonly Observation[];
      readonly changes: readonly Change[];
      /** The pairs the run's `redact` steps purge, without duplicates (`[]` when there is none). */
      readonly purge: readonly RedactPair[];
      /** One entry per `redact` step, in order: its subject and its own pairs (no duplicates within an entry). */
      readonly erased: readonly { readonly subject: string; readonly purge: readonly RedactPair[] }[];
    }
  | { readonly ok: false; readonly refusal: Refusal };

/** An expression result as a stored value: a feature becomes its id, a list maps element-wise. */
export function toJson(v: EvalValue): Json {
  if (Array.isArray(v)) return v.map(toJson);
  if (v !== null && typeof v === 'object' && '$feature' in v) return v.$feature;
  return v as Json;
}

/** A `date` property stores a calendar date: an expression such as `today() + months(1)` yields a timestamp. */
export function storable(env: Env, owner: FeatureId, type: Key, property: string, v: Json): Json {
  const def = envAt(env, owner).config.file.types?.[type]?.properties[property];
  return def?.type === 'date' && typeof v === 'string' && v.length > 10 && v[10] === 'T' ? v.slice(0, 10) : v;
}

const bad = (message: string, path: string): StepsResult => ({
  ok: false,
  refusal: refuse('invalid_input', message, path),
});

export function runSteps(s: StepInput): StepsResult {
  const { env, run, task } = s;
  const vars = new Map<string, EvalValue>([...s.vars, ['form', s.form]]);
  const ctx = guardedContext(env, run.actor, vars);
  const pointerCtx = guardedContext(env, run.actor, vars, true);
  const observations: Observation[] = [];
  const changes: Change[] = [];
  let conditionalRan = false;
  const purge = new Map<string, RedactPair>();
  const erased: { subject: string; purge: readonly RedactPair[] }[] = [];
  const steps = task.then ?? [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as NonNullable<Task['then']>[number];
    if (step.when !== undefined) {
      const ok = condition(compiled(env.config, kp('tasks', run.task, 'then', i, 'when')), ctx).value;
      if (!ok) continue;
      conditionalRan = true;
    } else if (step.otherwise === true && conditionalRan) continue;
    const written: Observation[] = [];
    if (step.redact !== undefined) {
      let id: Json | undefined = step.redact.subject === 'feature' ? s.subject?.id : undefined;
      if (step.redact.of !== undefined) {
        const of = kp('tasks', run.task, 'then', i, 'redact', 'of');
        const r = evaluate(compiled(env.config, of), pointerCtx);
        if (!r.ok) return bad(`step ${i}: ${r.error.message}`, of);
        id = toJson(r.value);
      }
      const red = redactStep(env, run, step.redact, i, id);
      if (!red.ok) return { ok: false, refusal: red.refusal };
      const denied = denyWrites(s, red.observations);
      if (denied !== undefined) return { ok: false, refusal: denied };
      changes.push(...env.overlay.apply(run.id, red.observations));
      observations.push(...red.observations);
      const own = new Map<string, RedactPair>();
      for (const p of red.purge) {
        const k = `${p.featureId}\u0000${p.property}`;
        own.set(k, p);
        purge.set(k, p);
      }
      erased.push({ subject: red.subject, purge: [...own.values()] });
      continue;
    }
    if (step.lifecycle !== undefined) {
      let ids: readonly FeatureId[];
      if (step.of !== undefined) {
        const t = resolveTargets(s, pointerCtx, i);
        if (!t.ok) return t;
        ids = t.targets.map((x) => x.id);
      } else if (s.subject === undefined) {
        return bad(
          `step ${i} sets the lifecycle but the task has no feature`,
          kp('tasks', run.task, 'then', i),
        );
      } else ids = [s.subject.id];
      for (const id of ids) {
        const gone = lifecycleStep(s, ctx, id, step.lifecycle as LifecycleState, step.of !== undefined);
        if (gone !== undefined) return { ok: false, refusal: gone };
      }
      const obs: Observation[] = ids.map((id) => ({
        featureId: id,
        property: RESERVED_LIFECYCLE,
        result: step.lifecycle as LifecycleState,
        ...(run.clientTime !== undefined ? { phenomenonTime: run.clientTime } : {}),
      }));
      changes.push(...env.overlay.apply(run.id, obs));
      observations.push(...obs);
      continue;
    }
    let ofTargets: readonly Target[] | undefined;
    if (step.of !== undefined) {
      const t = resolveTargets(s, pointerCtx, i);
      if (!t.ok) return t;
      ofTargets = t.targets;
    }
    for (const [target, value] of Object.entries(step.set ?? {})) {
      const path = kp('tasks', run.task, 'then', i, 'set', target);
      const dot = target.indexOf('.');
      let owners: readonly Target[] = s.subject ? [s.subject] : [];
      let property = target;
      if (ofTargets !== undefined) owners = ofTargets;
      else if (dot >= 0) {
        const name = target.slice(0, dot);
        property = target.slice(dot + 1);
        const bound = task.bind !== undefined && Object.hasOwn(task.bind, name) ? vars.get(name) : undefined;
        if (bound === undefined) {
          return {
            ok: false,
            refusal: refuse('bind_undeclared', `'${name}' is not a bind of '${run.task}'`, path),
          };
        }
        const id = toJson(bound) as FeatureId;
        const type = env.overlay.feature(id)?.type;
        if (type === undefined)
          return { ok: false, refusal: refuse('bind_unresolved', `bind '${name}' is gone`, path) };
        owners = [{ id, type }];
      }
      if (owners.length === 0 && ofTargets === undefined)
        return bad(`step ${i} sets '${target}' but the task has no feature`, path);
      let raw: Json = value;
      if (typeof value === 'string') {
        const r = evaluate(compiled(env.config, path), ctx);
        if (!r.ok) return bad(`step ${i}: ${r.error.message}`, path);
        raw = toJson(r.value);
      }
      for (const owner of owners) {
        written.push({
          featureId: owner.id,
          property,
          result: typeof value === 'string' ? storable(env, owner.id, owner.type, property, raw) : raw,
          ...(run.clientTime !== undefined ? { phenomenonTime: run.clientTime } : {}),
        });
      }
    }
    const denied = denyWrites(s, written);
    if (denied !== undefined) return { ok: false, refusal: denied };
    changes.push(...env.overlay.apply(run.id, written));
    observations.push(...written);
  }
  return { ok: true, observations, changes, purge: [...purge.values()], erased };
}

/** Write permission for participants on features that already existed; a created feature is covered by `create`. */
export function denyWrites(s: StepInput, written: readonly Observation[]): Refusal | undefined {
  const { env } = s;
  const checked = new Set<FeatureId>();
  for (const o of written) {
    const creating = s.created && o.featureId === s.subject?.id;
    const type = creating ? s.subject?.type : env.overlay.feature(o.featureId)?.type;
    if (type === undefined) continue;
    // A reference value must name a live, visible feature of the declared type (WP-755).
    const bad = referenceFault(
      env,
      s.run.actor,
      type,
      o.property,
      o.result,
      creating ? o.featureId : undefined,
    );
    if (bad !== undefined) return bad;
    if (creating || checked.has(o.featureId) || !isBound(s.run.actor)) continue;
    checked.add(o.featureId);
    const unseen = liveAndVisible(env, s.run.actor, o.featureId, 'permissions.see');
    if (unseen !== undefined) return unseen;
  }
  if (!isBound(s.run.actor)) return undefined;
  // A write is validated under the version of the feature it lands on (A-029 §2): group by that version, then by type.
  const byView = new Map<Env, Map<Key, string[]>>();
  for (const o of written) {
    if (s.created && o.featureId === s.subject?.id) continue;
    const type = env.overlay.feature(o.featureId)?.type;
    if (type === undefined) continue;
    const view = envAt(env, o.featureId);
    const byType = byView.get(view) ?? new Map<Key, string[]>();
    byType.set(type, [...(byType.get(type) ?? []), o.property]);
    byView.set(view, byType);
  }
  for (const [view, byType] of byView) {
    const subjects = view.perms.subjects(s.run.actor);
    for (const [type, props] of byType) {
      const d = view.perms.forType(type)?.canWrite(subjects, props);
      if (d === undefined || !d.ok) {
        const p = d !== undefined && !d.ok ? d.property : undefined;
        return refuse(
          'not_permitted',
          `the actor may not write ${type}${p === undefined ? '' : `.${p}`}`,
          p ?? 'permissions.write',
        );
      }
    }
  }
  return undefined;
}
