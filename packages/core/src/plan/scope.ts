/**
 * The checks that run before a task's form (docs/03 "life of a run"): target, `on`, permission to
 * see, binds and `when`. `available` is exactly this (one implementation); `plan` calls it, so the
 * UI's "offered" and the planner's "refused" cannot disagree (R1).
 */
import { condition, evaluate } from '../expr/evaluate';
import type { EvalContext, EvalValue, FeatureRef } from '../expr/contract';
import { explain } from '../expr/explain';
import type { FormApi } from '../form/contract';
import type { Actor, FeatureId, FeatureState, Json, Key, Refusal, Run } from '../model';
import { actorValue } from '../perms/actor';
import type { Ids } from '../ports';
import type { Perms } from '../perms/contract';
import { whoAdmits } from '../perms/who';
import { TASK_OFFERS } from '../registry';
import type { RefusalCode } from '../registry/refusals';
import type { CompiledConfig } from '../schema/compile/contract';
import { kp } from '../schema/compile/kp';
import type { Task } from '../schema/task';
import type { FeatureType } from '../schema/feature-type';
import type {
  Availability,
  ConfigFor,
  PlanPorts,
  ResolvedConfig,
  RuleTraceEntry,
  TaskTarget,
} from './contract';
import { featureAccess } from './access';
import { visibleOnly } from './guard';
import type { Overlay } from './overlay';
import { isServed } from '../registry/lifecycle';

/** Everything one plan call reads; built once per call by `createPlan`. */
export interface Env {
  readonly config: CompiledConfig;
  readonly perms: Perms;
  readonly ports: PlanPorts;
  /** Mints the ids of a rule run and of what a create makes: `planFor` seeds it per run, `fireRuleFor` takes the port. */
  readonly ids: Ids;
  readonly overlay: Overlay;
  readonly form: FormApi;
  /** Values of `inputs.<key>`: the template inputs' defaults (an overlay's values are merged into them). */
  readonly inputs: { readonly [key: string]: Json };
  /** The rule trace collector; undefined unless the caller asked for a trace (no allocation otherwise). */
  readonly trace?: RuleTraceEntry[];
  /** Features created in this batch so far, by actor id (the creation quota counts them, `quota.ts`). */
  readonly created: Map<string, number>;
  /** The config version `config` and `perms` belong to (`ResolvedConfig.version`). */
  readonly version?: ResolvedConfig['version'] | undefined;
  /** Resolves a feature's config (A-029); use `envAt`, never call it directly. */
  readonly configFor: ConfigFor;
  /** `envAt`'s cache, shared by every view of one plan call: one `configFor` call per key. */
  readonly views: Map<string, Env>;
  /** Ids of features created by this batch: they float on the deployed version (`NEW_FEATURE`). */
  readonly fresh: Set<FeatureId>;
}

/** A config problem compile() should have caught (an expression declared but not compiled): never planned around. */
export class PlanConfigError extends Error {
  constructor(readonly path: string) {
    super(`${path} is declared but has no compiled expression`);
    this.name = 'PlanConfigError';
  }
}

export const refuse = (
  code: RefusalCode,
  message: string,
  path?: string,
): Extract<Availability, { ok: false }>['refusal'] =>
  path === undefined ? { code, message } : { code, message, path };

/**
 * A create claims its feature id: refused (`id_taken`) when a feature with that id exists or this batch already
 * created it (WP-748). The one check for tasks, `$create`, `$seed` and rule-created features (R1).
 */
export function claimId(env: Env, id: FeatureId, path: string): Refusal | undefined {
  if (env.fresh.has(id) || env.overlay.feature(id) !== undefined)
    return refuse('id_taken', `a feature with the id '${id}' already exists`, path);
  env.fresh.add(id);
  return undefined;
}

export type Failure = Extract<Availability, { ok: false }>;
const fail = (code: RefusalCode, message: string, path?: string): Failure => ({
  ok: false,
  refusal: refuse(code, message, path),
});

/** Only participants are bound by role allowlists; system, import and admin actors are not (golden semantics 2). */
export const isBound = (actor: Actor): boolean => actor.kind === 'participant';

export const inputValues = (config: CompiledConfig): { readonly [key: string]: Json } =>
  Object.fromEntries(Object.entries(config.file.inputs ?? {}).map(([k, p]) => [k, p.default ?? null]));

export const compiled = (config: CompiledConfig, path: string) => {
  const c = config.expressions.get(path);
  if (c === undefined) throw new PlanConfigError(path);
  return c.typed;
};

export const ref = (id: FeatureId): FeatureRef => ({ $feature: id });

/** The context every expression of a run reads: `actor`, `inputs`, `self`, binds; `form` is added by the caller. */
export function evalContext(env: Env, actor: Actor, vars: ReadonlyMap<string, EvalValue>): EvalContext {
  const all = new Map<string, EvalValue>([['actor', actorValue(actor)], ['inputs', env.inputs], ...vars]);
  return {
    vars: all,
    features: featureAccess(env.overlay, env.config),
    now: env.ports.clock.now(),
    relations: env.config.relations,
    geo: env.ports.geo,
  };
}

/**
 * `evalContext` for a task's own expressions: a bound actor reads features it may not see as absent (WP-755) and
 * relation lists without them (WP-765). `pointers`: for `of` and bind, which keep hidden ids to refuse them loudly.
 */
export function guardedContext(
  env: Env,
  actor: Actor,
  vars: ReadonlyMap<string, EvalValue>,
  pointers = false,
): EvalContext {
  const raw = evalContext(env, actor, vars);
  if (!isBound(actor)) return raw;
  const open = evalContext(env, actor, new Map());
  const subjects = env.perms.subjects(actor);
  // Memo per context (WP-817): the actor and the overlay are fixed for one context's lifetime, so a feature's
  // `see` verdict is asked once however many reads of a filter pass reach it. Hold a context for one pass or one form.
  const seenBefore = new Map<FeatureId, boolean>();
  const visible = (id: FeatureId): boolean => {
    const known = seenBefore.get(id);
    if (known !== undefined) return known;
    const f = env.overlay.feature(id);
    const seen = f === undefined ? undefined : env.perms.forType(f.type)?.canSee(subjects, f, open);
    const verdict = seen !== undefined && seen.ok;
    if (f !== undefined) seenBefore.set(id, verdict);
    return verdict;
  };
  const member = (id: FeatureId): boolean => {
    const f = env.overlay.feature(id);
    return f !== undefined && isServed(f.lifecycle) && visible(id);
  };
  return { ...raw, features: visibleOnly(raw.features, { visible, member }, !pointers) };
}

export interface Scope {
  readonly ok: true;
  readonly task: Task;
  readonly self: FeatureState | undefined;
  /** `self` and the binds, by name. */
  readonly vars: ReadonlyMap<string, EvalValue>;
  readonly ctx: EvalContext;
}

const offers = TASK_OFFERS.keys as readonly string[];

/** Types a task is offered on (empty for `$map` and `$none`). */
const onTypes = (task: Task): readonly string[] =>
  typeof task.on === 'string' ? (offers.includes(task.on) ? [] : [task.on]) : task.on;

/** The target a run of this task addresses (`$map`: the new feature's position; no feature yet). */
export function targetOf(task: Task, run: Run): TaskTarget {
  if (task.on === '$map') return { map: true };
  return run.featureId === undefined ? { none: true } : { feature: run.featureId };
}

/**
 * The task's binds, by name: each is the Objekt its expression yields, or `null` when it yields none (unknown, hidden
 * from the actor, or not on this device). The one place a bind is evaluated: `scope` refuses on a `null`, the
 * participant form shows the bind's fields as not relevant (R1). `base` holds `self` (when the target has one).
 */
export function bindVars(
  env: Env,
  taskKey: Key,
  base: ReadonlyMap<string, EvalValue>,
  actor: Actor,
): ReadonlyMap<string, EvalValue> {
  const out = new Map<string, EvalValue>();
  const task = env.config.file.tasks?.[taskKey];
  const names = Object.keys(task?.bind ?? {});
  if (names.length === 0) return out;
  const bindCtx = guardedContext(env, actor, base, true);
  for (const name of names) {
    const r = evaluate(compiled(env.config, kp('tasks', taskKey, 'bind', name)), bindCtx);
    const value = r.ok ? r.value : null;
    out.set(name, value !== null && typeof value === 'object' && '$feature' in value ? value : null);
  }
  return out;
}

/** The Objektart a bind form field (`<bind>.<property>`, A-047) edits: its label and properties. */
export interface BoundType {
  readonly label: FeatureType['label'];
  readonly properties: FeatureType['properties'];
}

/**
 * For each bind the task's form names with a `<bind>.<property>` field: the Objektart its expression yields (from the
 * compiled type). The one derivation the participant form and the builder preview share (R1).
 */
export function boundTypes(config: CompiledConfig, taskKey: Key): Readonly<Record<string, BoundType>> {
  const task = config.file.tasks?.[taskKey];
  const named = new Set(
    Object.keys(task?.form ?? {})
      .filter((k) => k.includes('.'))
      .map((k) => k.slice(0, k.indexOf('.'))),
  );
  const out: Record<string, BoundType> = {};
  for (const name of Object.keys(task?.bind ?? {})) {
    if (!named.has(name)) continue;
    const ty = config.expressions.get(kp('tasks', taskKey, 'bind', name))?.typed.type;
    const type = ty?.kind === 'feature' ? config.file.types?.[ty.type] : undefined;
    if (type !== undefined) out[name] = { label: type.label, properties: type.properties };
  }
  return out;
}

export function scope(env: Env, taskKey: Key, target: TaskTarget, actor: Actor, auto?: Key): Scope | Failure {
  const task = env.config.file.tasks?.[taskKey];
  if (task === undefined) return fail('unknown_task', `no task '${taskKey}'`);
  const types = onTypes(task);
  let self: FeatureState | undefined;
  if ('feature' in target) {
    self = env.overlay.feature(target.feature);
    if (self === undefined) return fail('unknown_feature', `feature ${target.feature} does not exist`);
    if (!isServed(self.lifecycle))
      return fail('case_closed', `feature ${target.feature} is ${self.lifecycle}`, 'lifecycle');
    if (task.on !== '$none' && !types.includes(self.type))
      return fail('not_available', `task '${taskKey}' is not offered on ${self.type}`, 'on');
  } else if ('map' in target ? task.on !== '$map' : task.on === '$map' || types.length > 0) {
    return fail('not_available', `task '${taskKey}' is not offered here`, 'on');
  }

  // Who may run the task (C-004): a person needs one of its roles (no `who`: no person), the system skips it only for its own auto entry.
  const ownAuto = auto !== undefined && env.config.autos.get(auto)?.task === taskKey;
  if (!whoAdmits(task, actor, ownAuto))
    return fail('not_permitted', `the actor may not run task '${taskKey}'`, 'who');

  const base = new Map<string, EvalValue>();
  if (self !== undefined) base.set('self', ref(self.id));
  const early = evalContext(env, actor, base);
  if (self !== undefined && isBound(actor)) {
    const perms = env.perms.forType(self.type);
    const seen = perms?.canSee(env.perms.subjects(actor), self, early);
    if (seen === undefined || !seen.ok)
      return fail('not_permitted', `the actor may not see ${self.id}`, 'permissions.see');
  }

  const vars = new Map(base);
  const resolved = bindVars(env, taskKey, base, actor);
  for (const [name, value] of resolved) {
    if (value === null) {
      // A bind with a form field `<bind>.<property>` is optional (A-047): without the Objekt the field is not relevant.
      if (Object.keys(task.form ?? {}).some((k) => k.startsWith(`${name}.`))) {
        vars.set(name, null);
        continue;
      }
      return fail('bind_unresolved', `bind '${name}' has no related feature`, `bind.${name}`);
    }
    vars.set(name, value);
  }
  const ctx = guardedContext(env, actor, vars);

  if (task.when !== undefined) {
    const typed = compiled(env.config, kp('tasks', taskKey, 'when'));
    if (!condition(typed, ctx).value) {
      const explanation = explain(typed, ctx);
      // false only because of the actor (roles, kind, id): about the person, not the entry (WP-787)
      const people =
        !explanation.more &&
        explanation.decisive.length > 0 &&
        explanation.decisive.every((p) => p.actorOnly);
      return people
        ? {
            ok: false,
            refusal: refuse('not_permitted', `the actor may not run task '${taskKey}'`, 'when'),
            explanation,
          }
        : {
            ok: false,
            refusal: refuse('not_available', `task '${taskKey}' is not available`, 'when'),
            explanation,
          };
    }
  }
  return { ok: true, task, self, vars, ctx };
}

export function availability(env: Env, taskKey: Key, target: TaskTarget, actor: Actor): Availability {
  const s = scope(env, taskKey, target, actor);
  return s.ok ? { ok: true } : s;
}
