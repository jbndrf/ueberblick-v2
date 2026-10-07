/**
 * Rules after a run (docs/05 rules, docs/07 "Rules offline"): `task.<key>` triggers and property
 * changes (`<type>.<property>`, `<type>.*`) fire event-triggered rules, each as a system run planned
 * through the same path as a submitted run. Time-based rules (`elapsed`, `schedule`) are fired by the
 * server clock through the same `fireOne` (`PlanApi.fireRule`), never from here. Depth-first; deeper
 * than PLAN_MAX_RULE_DEPTH is refused.
 */
import type { EvalValue } from '../expr/contract';
import type { Actor, FeatureId, Json, Key, Refusal, Run } from '../model';
import { autoPath } from '../schema/compile/autos';
import type { PlannedRun, RuleTraceEntry, RuleTraceTrigger } from './contract';
import type { Change } from './overlay';
import { envAt } from './resolve';
import { autoWhen } from './auto-eval';
import { evalContext, ref, refuse, type Env } from './scope';
import { judgeWhenRules } from './when-edge';

/** The actor of a rule run. Not bound by role allowlists (golden semantics 2); `when` still applies. */
export const SYSTEM_ACTOR = { id: 'system', kind: 'system', roles: [] } as const;

export interface Trigger {
  /** The run that caused the rules. */
  readonly run: Run;
  readonly task: Key;
  /** The feature the run created, else the one it was on. */
  readonly subject: FeatureId | undefined;
  /** The values the run submitted. */
  readonly form: { readonly [field: string]: Json };
  readonly changes: readonly Change[];
  /** The features the run created: a `{ when }` rule sees them as false before the run. */
  readonly created: readonly FeatureId[];
  readonly depth: number;
}

export type Outcome =
  | { readonly ok: true; readonly runs: readonly PlannedRun[] }
  | { readonly ok: false; readonly refusal: Refusal };
export type PlanOne = (env: Env, run: Run, depth: number) => Outcome;

/** Rules to fire, in order and once each: `task.<key>` first, then property changes in observation order. */
function fired(
  env: Env,
  t: Trigger,
): readonly { rule: string; subject: FeatureId | undefined; form: Trigger['form'] }[] {
  const out: { rule: string; subject: FeatureId | undefined; form: Trigger['form'] }[] = [];
  const seen = new Set<string>();
  const add = (trigger: string, subject: FeatureId | undefined, form: Trigger['form'], view?: Env): void => {
    for (const rule of (view ?? env).config.autosByTrigger.get(trigger) ?? []) {
      const id = `${rule}\u0000${subject}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ rule, subject, form });
    }
  };
  add(`task.${t.task}`, t.subject, t.form);
  for (const c of t.changes) {
    // A change to a feature triggers the rules of that feature's version.
    const view = envAt(env, c.featureId);
    add(`${c.type}.${c.property}`, c.featureId, {}, view);
    add(`${c.type}.*`, c.featureId, {}, view);
  }
  return out;
}

/** Trace only (env.trace set): every event rule no change of the run triggered. */
function traceUnmatched(
  env: Env,
  t: Trigger,
  candidates: ReturnType<typeof fired>,
  held: ReadonlySet<string>,
  out: RuleTraceEntry[],
): void {
  const matched = new Set(candidates.map((c) => c.rule));
  const seen = new Set<string>();
  for (const keys of env.config.autosByTrigger.values()) {
    for (const rule of keys) {
      if (matched.has(rule) || held.has(rule) || seen.has(rule)) continue;
      seen.add(rule);
      out.push({
        rule,
        reason: 'trigger_not_matched',
        depth: t.depth,
        trigger: { kind: 'run', causedBy: t.run.id },
      });
    }
  }
}

/** Where a rule run comes from: the run that triggered it, or (timer-fired) the system actor and config version alone. */
export interface Origin {
  /** What `when` reads as `actor`: the triggering run's actor, or the system actor for a timer. */
  readonly actor: Actor;
  readonly configVersion: Run['configVersion'];
  readonly clientTime?: string;
  /** What set the rules going: the triggering run, or the timer that came due. */
  readonly trigger: RuleTraceTrigger;
}

/** The run a rule run is caused by: only a `run` trigger has one (a timer's system run has none). */
function causedByOf(trigger: RuleTraceTrigger): Run['id'] | undefined {
  switch (trigger.kind) {
    case 'run':
      return trigger.causedBy;
    case 'timer':
      return undefined;
    default: {
      const unhandled: never = trigger;
      return unhandled;
    }
  }
}

/**
 * One rule for one subject: `when`, depth check, then the rule's task as a system run planned through
 * `planOne`. The single implementation for event-triggered rules (`fireRules`) and timer-fired ones
 * (`PlanApi.fireRule`). An empty `runs` means `when` was false. The rule trace (`env.trace`) records both.
 */
export function fireOne(
  run: Env,
  key: string,
  subject: FeatureId | undefined,
  form: Trigger['form'],
  origin: Origin,
  depth: number,
  planOne: PlanOne,
): Outcome {
  // A rule run uses its subject's version (A-029 §2).
  const env = envAt(run, subject);
  const auto = env.config.autos.get(key);
  if (auto === undefined) return { ok: true, runs: [] };
  const trace = env.trace;
  const causedBy = causedByOf(origin.trigger);
  const vars = new Map<string, EvalValue>([['form', form]]);
  if (subject !== undefined) vars.set('self', ref(subject));
  const ctx = evalContext(env, origin.actor, vars);
  const base = {
    rule: key,
    depth,
    trigger: origin.trigger,
    ...(subject !== undefined ? { subject } : {}),
  };
  const when = autoWhen(env.config, auto, ctx);
  if (!when.held) {
    trace?.push({ ...base, reason: 'when_false', explanation: when.explanation });
    return { ok: true, runs: [] };
  }
  if (depth + 1 > env.ports.limits.ruleDepth) {
    const refusal = refuse(
      'depth_exceeded',
      `rule '${key}' would run deeper than ${env.ports.limits.ruleDepth}`,
      autoPath(auto),
    );
    trace?.push({ ...base, reason: 'depth_exceeded', refusal });
    return { ok: false, refusal };
  }
  const slot = trace?.push({ ...base, reason: 'fired' }) ?? 0;
  const refuseTrace = (refusal: Refusal): void => {
    if (trace !== undefined) trace[slot - 1] = { ...base, reason: 'refused', refusal };
  };

  const target = env.config.file.tasks?.[auto.task];
  const child: Run = {
    id: env.ids.runId(),
    task: auto.task as Key,
    actor: SYSTEM_ACTOR,
    auto: key as Key,
    configVersion: env.version ?? origin.configVersion,
    ...(subject !== undefined && target?.on !== '$map' ? { featureId: subject } : {}),
    input: {},
    ...(origin.clientTime !== undefined ? { clientTime: origin.clientTime } : {}),
    ...(causedBy !== undefined ? { causedBy } : {}),
  };
  const r = planOne(env, child, depth + 1);
  if (!r.ok) {
    const refusal = {
      ...r.refusal,
      message: `rule '${key}': ${r.refusal.message}`,
      path: r.refusal.path ?? autoPath(auto),
    };
    refuseTrace(refusal);
    return { ok: false, refusal };
  }
  if (trace !== undefined) trace[slot - 1] = { ...base, reason: 'fired', run: child.id };
  const [head, ...rest] = r.runs;
  return { ok: true, runs: head === undefined ? [] : [{ ...head, rule: key }, ...rest] };
}

export function fireRules(env: Env, t: Trigger, planOne: PlanOne): Outcome {
  const runs: PlannedRun[] = [];
  const candidates = [...fired(env, t)];
  const origin: Origin = {
    actor: t.run.actor,
    configVersion: t.run.configVersion,
    ...(t.run.clientTime !== undefined ? { clientTime: t.run.clientTime } : {}),
    trigger: { kind: 'run', causedBy: t.run.id },
  };
  // `{ when }` rules: fire on false → true of the features this run touched (A-045).
  const held = new Set<string>();
  for (const v of judgeWhenRules(env, t.run.actor, t.run.id, t.changes, t.created)) {
    if (v.kind === 'edge') candidates.push({ rule: v.rule, subject: v.subject, form: {} });
    else {
      held.add(v.rule);
      env.trace?.push({
        rule: v.rule,
        reason: 'already_true',
        depth: t.depth,
        subject: v.subject,
        trigger: origin.trigger,
      });
    }
  }
  if (env.trace !== undefined) traceUnmatched(env, t, candidates, held, env.trace);
  for (const { rule, subject, form } of candidates) {
    const r = fireOne(env, rule, subject, form, origin, t.depth, planOne);
    if (!r.ok) return r;
    runs.push(...r.runs);
  }
  return { ok: true, runs };
}
