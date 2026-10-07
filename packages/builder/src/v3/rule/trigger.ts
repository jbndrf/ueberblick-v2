/**
 * v3's Auslöser (`AutomationConfig.svelte:325-481`, glossary-lint-ignore) on v4's automatic action (`tasks.<t>.auto.<name>`, C-004): the
 * timing key plus the `when` parts the picker (glossary-lint-ignore) writes, so the admin never sees the rule language
 * (register a3-builder, lead-a decision 3 of WP-377). An entry is read back into one picker kind and the rest of
 * its `when` (the Bedingung rows); an entry the picker cannot say (a hand-written `elapsed.from`) reads as `undefined`
 * and stays untouched until the admin picks a kind. Pure, no DOM.
 *
 * v3 kind -> v4: on_create = `after: <entry>`; on_task_run and on_task_outcome = `after: <key>`; on_transition =
 * `change: <type>.<stage property>` + `previous(..) == from` / `self.<stage> == to`; on_field_change = `change: <type>.<p>`
 * (several: `<type>.*` + `changed('a') || changed('b')`); elapsed = `elapsed` from the creation or the last
 * change or from entering the current phase (`changed_at('<stage property>')`, docs/06; the phase is a pin on
 * the entry's `when`); when = no timing key, the entry `when` is the condition that fires it when it turns true
 * (A-045; its rows are the one expression, so there is no separate Bedingung); scheduled = `schedule`.
 * v3's "inaktiv >= N" (`if_inactive_days`) on a schedule is `idle: days(N)` (WP-469, owner A10 b): the schedule then visits each
 * Objekt of the task's Objektart and fires on those idle that long (core `idleEnough`, server sweep).
 */
import type { AutoEntry, TemplateFile } from '@ueberblick/core';
import { parse } from '@ueberblick/core/expr/compile';
import { literalText } from '../../shell/conditions';
import { compose, leavesOf, type Leaf } from '../task/when';
import { changedList, previousEquals, selfEquals } from './when-parts';

/** The picker's kinds, in v3's order (v3: on_create, on_transition, on_field_change, scheduled, elapsed, on_task_run). */
export const TRIGGER_KINDS = [
  'create',
  'transition',
  'change',
  'schedule',
  'elapsed',
  'when',
  'task',
] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

/** What an elapsed rule counts from (the system fields of the feature: docs/06). */
export const SINCE_FIELDS = { created: 'self.$created_at', changed: 'self.$changed_at' } as const;
/** `entered` is v3's `entered_stage`: the time the stage property was last written. */
export const SINCES = ['created', 'changed', 'entered'] as const;
export type Since = (typeof SINCES)[number];

/** The duration functions the rule language has (`hours`, `days`, `months`). */
export const DURATION_UNITS = ['hours', 'days', 'months'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export type Trigger =
  | { readonly kind: 'create'; readonly task: string }
  | { readonly kind: 'task'; readonly task: string }
  /** `from` and `to` are stage options; '' is any. */
  | { readonly kind: 'transition'; readonly from: string; readonly to: string }
  /** `properties` empty is every property; `stage` '' is any. */
  | { readonly kind: 'change'; readonly properties: readonly string[]; readonly stage: string }
  /** `stage` is the phase a rule counting from `entered` is pinned to; '' is any (and always '' for the other sinces). */
  | {
      readonly kind: 'elapsed';
      readonly since: Since;
      readonly amount: number;
      readonly unit: DurationUnit;
      readonly stage: string;
    }
  /** Fires when `condition` (a rule-language condition on `self`) turns true. */
  | { readonly kind: 'when'; readonly condition: string }
  /** `idle` is the days a sweep waits since an Objekt's last change (v3 "Nur wenn inaktiv ≥ Tage"); absent: fires once. */
  | {
      readonly kind: 'schedule';
      readonly cron: string;
      readonly idle?: number;
      /** v3 "In Phase" (`in_stage_key`): a pin `self.<stage> == '<key>'` on the `when`; absent or '' is any. */
      readonly stage?: string;
    };

export interface RuleReading {
  /** undefined: the timing is one the picker cannot say. */
  readonly trigger: Trigger | undefined;
  /** The `when` without the parts the picker wrote (the Bedingung rows); undefined: none. */
  readonly rest: string | undefined;
}

export interface TriggerEnv {
  readonly type: string;
  /** The stage property of the type's process. */
  readonly stage: string | undefined;
}

type TaskDef = NonNullable<TemplateFile['tasks']>[string];

export const isEntryTask = (task: TaskDef | undefined, type: string): boolean =>
  task !== undefined && task.on === '$map' && task.creates === type;

const DAYS = /^days\(\s*(\d+)\s*\)$/;
const DURATION = /^(hours|days|months)\(\s*(\d+)\s*\)$/;

/** `changed_at('<property>')` as text, for the file. */
const changedAt = (property: string): string => `changed_at(${literalText(property)})`;

/** True when `from` is `changed_at` of the stage property (either quote style). */
function isEnteredStage(from: string, stage: string | undefined): boolean {
  const p = parse(from);
  if (stage === undefined || !p.ok || p.ast.kind !== 'call') return false;
  const arg = p.ast.args[0];
  return (
    p.ast.name === 'changed_at' &&
    p.ast.args.length === 1 &&
    arg !== undefined &&
    arg.kind === 'literal' &&
    arg.value === stage
  );
}

function sinceOf(from: string, stage: string | undefined): Since | undefined {
  const text = from.trim();
  if (text === SINCE_FIELDS.created) return 'created';
  if (text === SINCE_FIELDS.changed) return 'changed';
  return isEnteredStage(text, stage) ? 'entered' : undefined;
}

function timeTrigger(entry: AutoEntry, env: TriggerEnv): Trigger | undefined {
  if (entry.schedule !== undefined) {
    if (entry.idle === undefined) return { kind: 'schedule', cron: entry.schedule };
    const days = DAYS.exec(entry.idle.trim());
    // an `idle` the picker did not write (hours, months, an expression) reads as custom and stays untouched
    return days === null ? undefined : { kind: 'schedule', cron: entry.schedule, idle: Number(days[1]) };
  }
  const e = entry.elapsed;
  if (e === undefined) return undefined;
  const since = sinceOf(e.from, env.stage);
  const after = e.after === undefined ? undefined : DURATION.exec(e.after.trim());
  if (since === undefined || after === null || after === undefined || e.offset !== undefined)
    return undefined;
  return { kind: 'elapsed', since, unit: after[1] as DurationUnit, amount: Number(after[2]), stage: '' };
}

/** Takes the first leaf `pick` matches out of `leaves`. */
function take<T>(leaves: Leaf[], pick: (l: Leaf) => T | undefined): T | undefined {
  for (const [i, l] of leaves.entries()) {
    const v = pick(l);
    if (v !== undefined) {
      leaves.splice(i, 1);
      return v;
    }
  }
  return undefined;
}

export function readRule(file: TemplateFile, entry: AutoEntry, env: TriggerEnv): RuleReading {
  const parsed = leavesOf(entry.when);
  // A `when` that does not parse is all "rest": the rows show it as text, nothing is lost.
  const leaves: Leaf[] = parsed ?? [];
  const textOnly = parsed === undefined && entry.when !== undefined && entry.when.trim() !== '';
  const done = (trigger: Trigger | undefined): RuleReading => ({
    trigger,
    rest: textOnly ? entry.when : compose(leaves.map((l) => l.src)),
  });
  // No timing key: the entry `when` is the condition that fires it; it has no separate rows.
  if (AUTO_TIMING_KEYS.every((k) => entry[k] === undefined))
    return { trigger: { kind: 'when', condition: entry.when ?? '' }, rest: undefined };
  if (entry.elapsed !== undefined || entry.schedule !== undefined) {
    const tr = timeTrigger(entry, env);
    if (tr?.kind === 'elapsed' && tr.since === 'entered' && env.stage !== undefined) {
      const pin = take(leaves, (l) => selfEquals(l.ast, env.stage as string));
      return done({ ...tr, stage: pin ?? '' });
    }
    if (tr?.kind === 'schedule' && env.stage !== undefined) {
      const pin = take(leaves, (l) => selfEquals(l.ast, env.stage as string));
      return done(pin === undefined ? tr : { ...tr, stage: pin });
    }
    return done(tr);
  }
  if (entry.after !== undefined) {
    const task = entry.after;
    return done({ kind: isEntryTask(file.tasks?.[task], env.type) ? 'create' : 'task', task });
  }
  if (textOnly) return done(undefined);
  const prop = (entry.change ?? '').split('.').slice(1).join('.');
  const stage = env.stage;
  if (stage !== undefined && prop === stage) {
    const from = take(leaves, (l) => previousEquals(l.ast, stage));
    const to = take(leaves, (l) => selfEquals(l.ast, stage));
    return done({ kind: 'transition', from: from ?? '', to: to ?? '' });
  }
  const list = prop === '*' ? take(leaves, (l) => changedList(l.ast)) : undefined;
  const pin = stage === undefined ? undefined : take(leaves, (l) => selfEquals(l.ast, stage));
  return done({ kind: 'change', properties: prop === '*' ? (list ?? []) : [prop], stage: pin ?? '' });
}

/** The keys of an entry that are its timing (registry `AUTO_TIMING_KINDS` but the implicit `edge`, plus `schedule`'s `idle`). */
export const AUTO_TIMING_KEYS = ['after', 'change', 'elapsed', 'schedule', 'idle'] as const;
export type TimingKey = (typeof AUTO_TIMING_KEYS)[number];

export interface Written {
  /** The timing keys of the entry; every other timing key is removed. */
  readonly timing: Pick<AutoEntry, TimingKey>;
  /** The `when` leaves the trigger needs, in front of the admin's rows. */
  readonly leaves: readonly string[];
  /** An edge trigger: its condition is the whole `when` (the rows go into it). */
  readonly edge?: string;
}

/** The file's form of a trigger; undefined when it cannot be written here (a transition on a type without a process). */
export function writeTrigger(tr: Trigger, env: TriggerEnv): Written | undefined {
  switch (tr.kind) {
    case 'create':
    case 'task':
      return { timing: { after: tr.task }, leaves: [] };
    case 'schedule':
      return {
        timing: {
          schedule: tr.cron,
          // a schedule on a task offered on an Objektart needs `idle` (compile: auto_schedule_without_idle); 0 days is "any"
          idle: `days(${Math.max(0, tr.idle ?? 0)})`,
        },
        leaves:
          tr.stage === undefined || tr.stage === '' || env.stage === undefined
            ? []
            : [`self.${env.stage} == ${literalText(tr.stage)}`],
      };
    case 'when':
      return { timing: {}, leaves: [], edge: tr.condition };
    case 'elapsed': {
      const after = `${tr.unit}(${tr.amount})`;
      if (tr.since !== 'entered')
        return { timing: { elapsed: { from: SINCE_FIELDS[tr.since], after } }, leaves: [] };
      if (env.stage === undefined) return undefined;
      return {
        timing: { elapsed: { from: changedAt(env.stage), after } },
        leaves: tr.stage === '' ? [] : [`self.${env.stage} == ${literalText(tr.stage)}`],
      };
    }
    case 'transition': {
      if (env.stage === undefined) return undefined;
      return {
        timing: { change: `${env.type}.${env.stage}` },
        leaves: [
          ...(tr.from === '' ? [] : [`previous(${literalText(env.stage)}) == ${literalText(tr.from)}`]),
          ...(tr.to === '' ? [] : [`self.${env.stage} == ${literalText(tr.to)}`]),
        ],
      };
    }
    case 'change': {
      const many = tr.properties.length > 1;
      return {
        timing: { change: `${env.type}.${tr.properties.length === 1 ? (tr.properties[0] as string) : '*'}` },
        leaves: [
          ...(many ? [tr.properties.map((p) => `changed(${literalText(p)})`).join(' || ')] : []),
          ...(tr.stage === '' || env.stage === undefined
            ? []
            : [`self.${env.stage} == ${literalText(tr.stage)}`]),
        ],
      };
    }
  }
}

// A trigger of `kind` with v3's starting values (v3 `setTriggerType`, `AutomationConfig.svelte:112-139`). (glossary-lint-ignore)
export function startTrigger(
  kind: TriggerKind,
  file: TemplateFile,
  env: TriggerEnv,
  ownTask?: string,
): Trigger | undefined {
  const entry = Object.entries(file.tasks ?? {}).find(([, t]) => isEntryTask(t, env.type))?.[0];
  const task = Object.keys(file.tasks ?? {}).find(
    (k) => k !== ownTask && !isEntryTask(file.tasks?.[k], env.type),
  );
  switch (kind) {
    case 'create':
      return entry === undefined ? undefined : { kind, task: entry };
    case 'task':
      return task === undefined ? undefined : { kind, task };
    case 'transition':
      return env.stage === undefined ? undefined : { kind, from: '', to: '' };
    case 'change':
      return { kind, properties: [], stage: '' };
    case 'elapsed':
      return { kind, since: 'created', amount: 7, unit: 'days', stage: '' };
    case 'when': {
      const first = Object.keys(file.types?.[env.type]?.properties ?? {})[0];
      return { kind, condition: first === undefined ? 'true' : `self.${first} != null` };
    }
    case 'schedule':
      return { kind, cron: '0 2 * * *' };
  }
}
