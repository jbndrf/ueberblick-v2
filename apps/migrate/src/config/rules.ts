/**
 * v3 triggered tasks and standalone rule sets become v4 automatic actions (`tasks.<t>.auto.<name>`). An
 * automatic action only runs its task as a system run, so each step becomes a system task
 * (no `who`, so no person may run it) with an `auto` entry that names the timing and the condition.
 */
import type { AutoEntry, Task } from '@ueberblick/core';
import type { Ctx, TypeInfo } from './ctx';
import { noteTo, valueProp } from './ctx';
import { buildThen, effectEnv, type EffectResult } from './effects';
import { quote, translate } from './exprs';
import type { KeySpace } from './keys';
import type { Cond, SrcRule, SrcTask, Trigger } from './model';
import { buildWhen, addSpawns } from './tasks';

export interface RuleOut {
  readonly tasks: Record<string, Task>;
}

export interface Keys {
  readonly tasks: KeySpace;
  readonly rules: KeySpace;
}

/** The timing of one entry (`after`, `change` or `schedule` with `idle`) and its extra condition. */
interface Trig {
  readonly timing: Pick<AutoEntry, 'after' | 'change' | 'schedule' | 'idle'>;
  readonly when?: string;
}

/** The v4 property keys that a condition reads (for a `when` trigger: fire on any change of these). */
function condProps(c: Cond, type: TypeInfo, into = new Set<string>()): Set<string> {
  switch (c.kind) {
    case 'all':
    case 'any':
      for (const i of c.items) condProps(i, type, into);
      break;
    case 'not':
      condProps(c.item, type, into);
      break;
    case 'field':
    case 'field_to_field': {
      const p = valueProp(type, c.prop);
      if (p) into.add(p.key);
      if (c.kind === 'field_to_field') {
        const o = valueProp(type, c.other);
        if (o) into.add(o.key);
      }
      break;
    }
    case 'stage':
      into.add(type.stageKey);
      break;
    case 'instance_status':
      into.add(type.lifecycleKey);
      break;
    case 'related': {
      const p = type.props.get(c.via);
      if (p && p.relation === undefined) into.add(p.key);
      break;
    }
    default:
      break;
  }
  return into;
}

/** The v4 triggers for a v3 trigger, or `undefined` (and a note) when v4 has no equivalent. */
function triggersOf(t: Trigger, type: TypeInfo, ctx: Ctx, id: string, target: string): Trig[] | undefined {
  const note = noteTo(ctx.report, id, target);
  const stage = (s: string, fn: (k: string) => string): string | undefined => {
    if (type.stageOptions.size === 0) {
      note('approximated', 'the feature type has no stages; the stage condition is dropped');
      return undefined;
    }
    const k = type.stageOptions.get(s);
    if (k === undefined) note('approximated', `stage "${s}" does not exist`);
    return fn(k ?? s);
  };
  switch (t.kind) {
    case 'on_transition': {
      if (type.stageOptions.size === 0) {
        note('dropped', 'the feature type has no stages, so there is no stage change to react to');
        return undefined;
      }
      const conds: string[] = [];
      const to = t.to ? stage(t.to, (k) => `self.${type.stageKey} == ${quote(k)}`) : undefined;
      if (to) conds.push(to);
      if (t.from)
        note(
          'approximated',
          'the previous stage is not available to a rule condition; only the target stage is checked',
        );
      return [
        {
          timing: { change: `${type.key}.${type.stageKey}` },
          ...(conds.length ? { when: conds.join(' && ') } : {}),
        },
      ];
    }
    case 'on_field_change': {
      const scope = t.stage ? stage(t.stage, (k) => `self.${type.stageKey} == ${quote(k)}`) : undefined;
      const props = t.props.map((p) => valueProp(type, p)).filter((p) => p !== undefined);
      if (t.props.length > 0 && props.length === 0) {
        note('dropped', 'none of the watched fields exists');
        return undefined;
      }
      const ons = props.length > 0 ? props.map((p) => `${type.key}.${p.key}`) : [`${type.key}.*`];
      return ons.map((change) => ({ timing: { change }, ...(scope ? { when: scope } : {}) }));
    }
    case 'on_create': {
      if (type.entryTasks.length === 0) {
        note('dropped', 'no task creates features of this type, so there is no creation to react to');
        return undefined;
      }
      note(
        'approximated',
        'fires after each task that creates a feature of this type (imports do not fire it)',
      );
      return type.entryTasks.map((k) => ({ timing: { after: k } }));
    }
    case 'scheduled': {
      if (t.inactiveDays)
        note(
          'approximated',
          '"inactive for n days" is approximated by `idle`: the last change of a feature at least n days ago',
        );
      const scope = t.stage ? stage(t.stage, (k) => `self.${type.stageKey} == ${quote(k)}`) : undefined;
      // A schedule on a task offered on a type visits the features that were idle for `idle` (days(0): every feature).
      const idle = `days(${t.inactiveDays ?? 0})`;
      return [{ timing: { schedule: t.cron, idle }, ...(scope ? { when: scope } : {}) }];
    }
    case 'elapsed':
      note(
        'dropped',
        'v4 timers need a date property to count from; v3 counted from the time a feature entered a stage or was created, which v4 does not expose to rules',
      );
      return undefined;
    case 'when': {
      const props = [...condProps(t.cond, type)];
      if (props.length === 0) {
        note('dropped', 'the condition reads no property, so there is no change to react to');
        return undefined;
      }
      note(
        'approximated',
        'fires on every change of a property the condition reads while it holds, not only when it flips to true',
      );
      return props.map((p) => ({ timing: { change: `${type.key}.${p}` } }));
    }
    case 'on_task_run':
    case 'on_task_outcome': {
      const key = ctx.taskKeys.get(`${type.v3Key}/${t.task}`);
      if (!key) {
        note('dropped', `task "${t.task}" does not exist`);
        return undefined;
      }
      if (t.kind === 'on_task_outcome')
        note('approximated', 'fires after the task runs, whatever its outcome');
      return [{ timing: { after: key } }];
    }
    case 'unknown':
      note('dropped', `${t.label} is not known`);
      return undefined;
  }
}

interface Emit {
  readonly label: string;
  /** Base of the task and automatic action keys. */
  readonly base: string;
  /** A task key that was reserved earlier (a v3 task that other rules may name). */
  readonly taskKey?: string;
  readonly type: TypeInfo;
  readonly triggers: readonly Trig[];
  readonly when: string | undefined;
  readonly then: EffectResult;
}

const and = (parts: readonly (string | undefined)[]): string | undefined => {
  const kept = parts.filter((w): w is string => w !== undefined);
  if (kept.length === 0) return undefined;
  return kept.map((w) => (/ (\|\||&&) /.test(w) ? `(${w})` : w)).join(' && ');
};

/** One system task with its rules, and a system task plus rules for every spawned feature. */
function emit(e: Emit, keys: Keys, out: RuleOut): void {
  const taskKey = e.taskKey ?? keys.tasks.take(e.base);
  const task: Task = { label: e.label, on: e.type.key };
  if (e.then.steps.length > 0) task.then = e.then.steps;
  out.tasks[taskKey] = task;
  const staging: Record<string, Task> = {};
  const from = { key: e.base, t: { name: e.label }, type: e.type, when: undefined, roles: 'all' as const };
  const spawnKeys = addSpawns(e.then.spawns, from, keys.tasks, staging);
  // An automatic run has no form: a spawn the participant would have drawn keeps only its `then`.
  for (const [k, t] of Object.entries(staging)) out.tasks[k] = { ...t, form: undefined };
  for (const run of [taskKey, ...spawnKeys]) {
    const target = out.tasks[run];
    if (target === undefined) continue;
    e.triggers.forEach((trig, i) => {
      const name = keys.rules.take(e.triggers.length > 1 ? `${run}_${i + 1}` : run);
      const when = and([e.when, trig.when]);
      target.auto = { ...target.auto, [name]: { label: e.label, ...trig.timing, ...(when ? { when } : {}) } };
    });
  }
}

/** A v3 triggered task: its trigger, availability clauses as the rule's condition, effects as the system task. */
export function convertTriggeredTask(t: SrcTask, type: TypeInfo, ctx: Ctx, keys: Keys, out: RuleOut): void {
  const base = ctx.taskKeys.get(`${type.v3Key}/${t.key}`) ?? t.key;
  const target = `tasks.${base}.auto`;
  const triggers = t.trigger ? triggersOf(t.trigger, type, ctx, t.activationId, target) : undefined;
  for (const s of t.steps) {
    ctx.report.dropped(s.id, 'a triggered task has no acting participant, so no form');
    for (const p of s.v.placements) ctx.report.dropped(p.id, 'a triggered task has no form');
  }
  const when = buildWhen(t.conditions, type, ctx, false, target);
  const then = buildThen(t.effects, type, ctx, new Set<string>(), `tasks.${base}`, false);
  if (t.visual) ctx.report.dropped(t.visual.id, 'v4 tasks carry no button label, colour or icon');
  if (t.entry) ctx.report.dropped(t.entry.id, 'a triggered task cannot be an entry');
  if (triggers) {
    ctx.report.mapped(t.activationId, target);
    emit({ label: t.name, base, taskKey: base, type, triggers, when, then }, keys, out);
    ctx.report.mapped(t.id, `tasks.${base}`);
  } else {
    ctx.report.dropped(t.activationId, 'the trigger has no v4 equivalent (see the note on the trigger)');
    ctx.report.dropped(t.id, 'the trigger has no v4 equivalent, so the task would never run');
    ctx.taskKeys.delete(`${type.v3Key}/${t.key}`);
  }
}

/** A v3 standalone rule set: every step is a system task; `first_match` excludes earlier matching steps. */
export function convertRuleSet(r: SrcRule, type: TypeInfo, ctx: Ctx, keys: Keys, out: RuleOut): void {
  const target = `tasks.${r.key}.auto`;
  const triggers = triggersOf(r.trigger.v, type, ctx, r.trigger.id, target);
  const firstMatch = r.mode?.v === 'first_match';
  if (r.mode) {
    if (firstMatch) {
      ctx.report.approximated(
        r.mode.id,
        "each step's condition also excludes the conditions of the steps before it",
        target,
      );
    } else ctx.report.mapped(r.mode.id, target);
  }
  if (triggers) ctx.report.mapped(r.trigger.id, target);
  const env = effectEnv(type, ctx, new Set<string>());
  const earlier: string[] = [];
  r.steps.forEach(({ id, v: step }, i) => {
    const note = noteTo(ctx.report, step.when.id, `${target}.when`);
    const own = translate(step.when.v, env, note);
    const ownOrUndefined = own === 'true' ? undefined : own;
    const prior = earlier.length === 1 ? (earlier[0] as string) : earlier.map((c) => `(${c})`).join(' || ');
    const when = firstMatch && earlier.length > 0 ? and([ownOrUndefined, `!(${prior})`]) : ownOrUndefined;
    earlier.push(own);
    ctx.report.mapped(step.when.id, `${target}.when`);
    const then = buildThen(step.effects, type, ctx, new Set<string>(), `tasks.${r.key}`, false);
    if (!triggers) {
      ctx.report.dropped(id, 'the trigger of the rule set has no v4 equivalent');
      return;
    }
    const many = r.steps.length > 1;
    const base = many ? `${r.key}_${i + 1}` : r.key;
    emit({ label: many ? `${r.name}: ${step.name}` : r.name, base, type, triggers, when, then }, keys, out);
    ctx.report.mapped(id, `tasks.${base}.auto`);
  });
  if (triggers) ctx.report.mapped(r.id, target);
  else ctx.report.dropped(r.id, 'the trigger has no v4 equivalent');
}
