/** v3 tasks (buttons) become v4 tasks: `on`, `when`, `form`, `then`. */
import type { Task } from '@ueberblick/core';
import type { Ctx, PropInfo, TypeInfo } from './ctx';
import { noteTo, valueProp } from './ctx';
import { effectEnv, buildThen, type Spawn, type ThenStep } from './effects';
import { assignment, translate } from './exprs';
import { formulaFor } from './formula';
import { K } from './read-parts';
import type { KeySpace } from './keys';
import type { Cond, FormStep, Item, Placement, SrcTask } from './model';

type FormField = NonNullable<Task['form']>[string];

export interface Converted {
  readonly key: string;
  readonly task: Task;
  /** Extra tasks for effects that spawn other features (`key` to task). */
  readonly extra: Record<string, Task>;
}

/** The roles a top-level `role` clause names; `all` when the task is open to every role. */
function rolesOf(conditions: readonly Item<Cond>[], ctx: Ctx): Set<string> | 'all' {
  const roles = new Set<string>();
  let restricted = false;
  for (const { v } of conditions) {
    if (v.kind !== 'role' || v.roles.length === 0) continue;
    restricted = true;
    for (const r of v.roles) {
      const known = ctx.knownRole(r);
      if (known !== undefined) roles.add(known);
    }
  }
  return restricted ? roles : 'all';
}

/**
 * The `who` of a task from the roles its v3 `role` clauses name (C-004): those roles; open to every role, the task is
 * open to all roles of the project and to an admin. No known role left: no `who`, so only the system may run it.
 */
export function whoOf(roles: Set<string> | 'all', ctx: Ctx): string[] | undefined {
  const who = roles === 'all' ? [...ctx.roleKeys.values(), 'admin'] : [...roles];
  return who.length > 0 ? who : undefined;
}

/** Adds `roles` to what may create features of `type`: any unrestricted creating task opens it to all. */
export function allowCreate(type: TypeInfo, roles: Set<string> | 'all'): void {
  if (roles === 'all' || type.createRoles === 'all') type.createRoles = 'all';
  else type.createRoles = new Set([...(type.createRoles ?? []), ...roles]);
}

/** The fields of a task's form: every placement of every form step, geometry input for `$map` creation. */
export function buildForm(
  steps: readonly Item<FormStep>[],
  type: TypeInfo,
  ctx: Ctx,
  entry: boolean,
  target: string,
  roles: Set<string> | 'all' = 'all',
): { form: Record<string, FormField>; keys: Set<string> } {
  const form: Record<string, FormField> = {};
  const keys = new Set<string>();
  const usable = steps.filter(
    ({ v }) => v.kind !== K.toolRule && !(v.kind === 'quick_edit' && v.mode === 'location'),
  );
  const env = effectEnv(type, ctx, keys, entry);
  // The form's own field keys are needed to translate `show_if`, so collect them first.
  for (const { v } of usable)
    for (const p of v.placements)
      if (!p.v.related && type.props.has(p.v.prop) && !readOnlyFor(type, p.v.prop, roles)) keys.add(p.v.prop);
  let forms = 0;
  for (const { id, v: step } of steps) {
    const note = noteTo(ctx.report, id, `${target}.form`);
    if (step.kind === K.toolRule) {
      note('dropped', 'the deprecated rule tool kind has no v4 form; use a rule');
      for (const p of step.placements) ctx.report.dropped(p.id, 'belongs to a step that has no v4 form');
      continue;
    }
    if (++forms > 1) note('approximated', 'several form steps are merged into one form (order kept)');
    if (step.kind === 'quick_edit' && step.mode === 'location') {
      if (type.geomKey) {
        form[type.geomKey] = { tool: 'draw', required: true };
        ctx.toolsUsed.add('draw');
        ctx.report.mapped(id, `${target}.form.${type.geomKey}`);
      } else note('dropped', 'the feature type has no geometry to edit');
      for (const p of step.placements) ctx.report.dropped(p.id, 'a location edit has no fields');
      continue;
    }
    if (step.hasConfig)
      note('approximated', 'step settings are dropped; v4 forms take their settings from the fields');
    for (const item of step.placements) placement(item, type, ctx, env, form, entry, `${target}.form`, roles);
    ctx.report.mapped(id, `${target}.form`);
  }
  if (entry && type.geomKey) {
    ctx.toolsUsed.add('draw');
    const { [type.geomKey]: existing, ...rest } = form;
    return { form: { [type.geomKey]: { tool: 'draw', required: true, ...existing }, ...rest }, keys };
  }
  return { form, keys };
}

/** True when v3 restricted writing the field to roles that do not cover every role of the task. */
function readOnlyFor(type: TypeInfo, v3: string, roles: Set<string> | 'all'): boolean {
  const p = valueProp(type, v3);
  if (p?.write === undefined || p.writeMode === 'computed') return false;
  const write = p.write;
  return roles === 'all' || [...roles].some((r) => !write.includes(r));
}

function placement(
  { id, v: p }: Item<Placement>,
  type: TypeInfo,
  ctx: Ctx,
  env: ReturnType<typeof effectEnv>,
  form: Record<string, FormField>,
  entry: boolean,
  target: string,
  roles: Set<string> | 'all',
): void {
  const note = noteTo(ctx.report, id, target);
  const pi: PropInfo | undefined = valueProp(type, p.prop);
  if (!pi) {
    note('dropped', `field "${p.prop}" does not exist`);
    return;
  }
  if (readOnlyFor(type, p.prop, roles)) {
    note(
      'approximated',
      'shown read-only in v3; not in the v4 form (the roles of this task may not write it)',
    );
    return;
  }
  if (p.related) {
    note('dropped', 'a field of a related feature is not part of a v4 form; use `bind` and a `then` step');
    return;
  }
  const field: FormField = {};
  if (form[pi.key]) note('approximated', `field "${p.prop}" appears twice; the later placement wins`);
  if (p.required) field.required = true;
  if (p.showIf) {
    const cond = translate(p.showIf, env, note);
    if (cond !== 'true') field.relevant = cond;
  }
  const constraints = [...pi.constraints];
  let message = pi.constraintMessage;
  if (p.forceDirty) {
    if (entry) note('approximated', '"force dirty" is meaningless while creating; dropped');
    else {
      constraints.push(`value != self.${pi.key}`);
      message = message ?? 'Der Wert muss geändert werden';
    }
  }
  if (constraints.length > 0) {
    field.constraint = constraints.join(' && ');
    if (message) field.constraint_message = message;
  }
  if (p.prefill.kind === 'constant' && p.prefill.value !== undefined) {
    const lit = assignment(pi, p.prefill.value, note);
    if (lit !== undefined) field.calculate = lit;
  } else if (p.prefill.kind === 'last_value') {
    if (entry) note('approximated', '"last value" prefill has nothing to read while creating; dropped');
    else field.calculate = `self.${pi.key}`;
  } else if (p.prefill.kind === 'computed') {
    const f = formulaFor(p.prefill.expression ?? '', env, pi, note);
    if (f !== undefined) field.calculate = f;
  }
  if (pi.appearance) field.appearance = pi.appearance;
  if (p.placeholder) note('approximated', 'the placeholder text is dropped; v4 fields have none');
  if (p.helpText && pi.def.description === undefined) pi.def.description = p.helpText;
  if (p.layout) note('approximated', 'page, row and column are laid out by the renderer; the order is kept');
  form[pi.key] = field;
  ctx.report.mapped(id, `${target}.${pi.key}`);
}

/** Translates a task's availability clauses; entry tasks ignore stage and ownership (as in v3). */
export function buildWhen(
  conditions: readonly Item<Cond>[],
  type: TypeInfo,
  ctx: Ctx,
  entry: boolean,
  target: string,
  /** A pull task keeps its `role` clauses out of `when`: they are its `who`. */
  rolesAreWho = false,
): string | undefined {
  const env = effectEnv(type, ctx, new Set<string>(), entry);
  const parts: string[] = [];
  for (const { id, v } of conditions) {
    if (rolesAreWho && v.kind === 'role') {
      ctx.report.mapped(id, `${target}.who`);
      continue;
    }
    const note = noteTo(ctx.report, id, `${target}.when`);
    const s = translate(v, env, note);
    if (s !== 'true') parts.push(s);
    ctx.report.mapped(id, `${target}.when`);
  }
  if (parts.length === 1) return parts[0];
  return parts.length > 0 ? parts.map((p) => (/ (\|\||&&) /.test(p) ? `(${p})` : p)).join(' && ') : undefined;
}

/** Converts an available (pull) task; its key was reserved in `ctx.taskKeys` beforehand. */
export function convertAvailable(t: SrcTask, type: TypeInfo, ctx: Ctx, taskKeys: KeySpace): Converted {
  const key = ctx.taskKeys.get(`${type.v3Key}/${t.key}`) ?? taskKeys.take(t.key);
  const target = `tasks.${key}`;
  const entry = t.entry !== undefined;
  const roles = rolesOf(t.conditions, ctx);
  const { form, keys } = buildForm(t.steps, type, ctx, entry, target, roles);
  const when = buildWhen(t.conditions, type, ctx, entry, target, true);
  const then = buildThen(t.effects, type, ctx, keys, target, entry, roles);
  const task: Task = { label: t.name, on: entry ? (type.geomKey ? '$map' : '$none') : type.key };
  const who = whoOf(roles, ctx);
  if (who) task.who = who;
  if (when) task.when = when;
  if (entry) task.creates = type.key;
  if (Object.keys(form).length > 0) task.form = form;
  if (then.steps.length > 0) task.then = then.steps;
  if (entry) {
    type.entryTasks.push(key);
    allowCreate(type, roles);
    ctx.report.mapped(t.entry?.id ?? t.id, `${target}.creates`);
  }
  if (t.visual)
    ctx.report.dropped(t.visual.id, 'v4 tasks carry no button label, colour or icon; the app derives them');
  ctx.report.mapped(t.activationId, `${target}.on`);
  ctx.report.mapped(t.id, target);
  const extra: Record<string, Task> = {};
  addSpawns(then.spawns, { key, t, type, when, roles, who }, taskKeys, extra);
  return { key, task, extra };
}

export interface SpawnFrom {
  readonly key: string;
  readonly t: { readonly name: string };
  readonly type: TypeInfo;
  readonly when: string | undefined;
  readonly roles: Set<string> | 'all';
  /** Who may run the spawning task (its `who`); the spawn tasks of a rule have none. */
  readonly who?: string[] | undefined;
}

/** Each spawning effect becomes a task on the source type that creates the target. */
export function addSpawns(
  spawns: readonly Spawn[],
  from: SpawnFrom,
  taskKeys: KeySpace,
  out: Record<string, Task>,
): string[] {
  const made: string[] = [];
  spawns.forEach((s, i) => {
    const key = taskKeys.take(`${from.key}_spawn_${i + 1}`);
    const task: Task = { label: `${from.t.name}: ${s.target.key}`, on: from.type.key, creates: s.target.key };
    if (from.who) task.who = from.who;
    if (from.when) task.when = from.when;
    if (s.form) task.form = s.form;
    if (s.then.length > 0) task.then = s.then as ThenStep[];
    out[key] = task;
    s.target.entryTasks.push(key);
    allowCreate(s.target, from.roles);
    made.push(key);
  });
  return made;
}
