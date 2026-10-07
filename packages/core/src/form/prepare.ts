/**
 * Looks up a task's form expressions once per compiled config (`tasks.<task>.form.<field>.<attr>`).
 * A declared expression without a compiled one throws (fail closed, like perms): a form that silently
 * lost a `relevant` or `constraint` would accept what the project file forbids.
 */
import type { TypedAst } from '../expr/check/check';
import type { Key } from '../model';
import type { CompiledConfig } from '../schema/compile/contract';
import { kp } from '../schema/compile/kp';
import type { LocalizedString } from '../schema';
import type { Property } from '../schema/property';
import type { Task } from '../schema/task';
import type { TaskStepKind } from '../registry';
import { stepsOf } from '../schema/steps-of';
import type { FormAttribute } from './contract';
import { formReads, type FormReads } from './reads';

export class FormConfigError extends Error {
  constructor(
    readonly task: string,
    message: string,
    readonly field?: string,
    readonly attr?: FormAttribute,
  ) {
    super(message);
    this.name = 'FormConfigError';
  }
}

/** A literal boolean or a compiled expression. */
export type Flag = boolean | TypedAst;

export interface PreparedField {
  readonly key: Key;
  readonly relevant?: TypedAst;
  readonly required: Flag;
  readonly readonly: Flag;
  readonly constraint?: TypedAst;
  readonly constraintMessage?: LocalizedString;
  readonly calculate?: TypedAst;
  /** ODK `choice_filter` (select and multiselect): evaluated per option with `option` bound. */
  readonly choiceFilter?: TypedAst;
  /** The fields the `choice_filter` reads (v3: the dependent select's source field). */
  readonly choiceReads?: FormReads;
  /** True when the `calculate` reads `now`: the device and the server compute different values. */
  readonly calculatesNow: boolean;
  /** Which fields' values the expressions read. */
  readonly reads: FormReads;
  /** Which fields' values the `relevant` expression reads (the cascade order and `dependents`). */
  readonly relevantReads: FormReads;
  /** The property the field is bound to, for the type issue (of the bound Objektart for a bind field). */
  readonly property?: Property;
  /** A `<bind>.<property>` field (A-047): the bind's name, the Objektart it yields and the property key on it. */
  readonly bind?: { readonly name: Key; readonly type: Key; readonly property: string };
  /** Set for a property of a `quick_edit` or `location` step: it has no expressions and is checked only when submitted. */
  readonly step?: Exclude<TaskStepKind, 'form'>;
}

export interface PreparedForm {
  readonly task: Key;
  readonly fields: readonly PreparedField[];
  /** False when `on` lists several types and none was given: `evaluate` then needs a `type` argument. */
  readonly typeKnown: boolean;
  /**
   * Calculated fields that may be readonly, in dependency order (a field after the calculated fields
   * it reads; form order otherwise). A cycle is a `FormConfigError`.
   */
  readonly calcOrder: readonly PreparedField[];
  /**
   * Fields with a `relevant` expression, ordered so that one reading another's value comes after it: the
   * ODK cascade drops a non-relevant field before its readers evaluate. A cycle keeps form order.
   */
  readonly relevanceOrder: readonly PreparedField[];
}

function orderRelevance(fields: readonly PreparedField[]): PreparedField[] {
  const nodes = fields.filter((f) => f.relevant !== undefined || f.bind !== undefined);
  const done = new Set<string>();
  const out: PreparedField[] = [];
  const waits = (n: PreparedField, m: PreparedField): boolean =>
    m !== n && !done.has(m.key) && (n.relevantReads.all || n.relevantReads.fields.has(m.key));
  while (out.length < nodes.length) {
    const rest = nodes.filter((n) => !done.has(n.key));
    const next = rest.find((n) => !rest.some((m) => waits(n, m))) ?? (rest[0] as PreparedField);
    done.add(next.key);
    out.push(next);
  }
  return out;
}

function orderCalculated(task: Key, fields: readonly PreparedField[]): PreparedField[] {
  const nodes = fields.filter((f) => f.calculate !== undefined && f.readonly !== false);
  const done = new Set<string>();
  const out: PreparedField[] = [];
  while (out.length < nodes.length) {
    const next = nodes.find(
      (n) =>
        !done.has(n.key) &&
        nodes.every((m) => m === n || done.has(m.key) || !(n.reads.all || n.reads.fields.has(m.key))),
    );
    if (!next) {
      const cyc = nodes.filter((n) => !done.has(n.key)).map((n) => n.key);
      throw new FormConfigError(task, `readonly calculated fields depend on each other: ${cyc.join(', ')}`);
    }
    done.add(next.key);
    out.push(next);
  }
  return out;
}

const cache = new WeakMap<CompiledConfig, Map<string, PreparedForm>>();

/** The feature type a task's form is bound to: `type` if given, else `creates`, else a single `on` type. */
function targetType(def: Task, type: Key | undefined): Key | undefined {
  if (type !== undefined) return type;
  if (def.creates !== undefined) return def.creates as Key;
  const on = Array.isArray(def.on) ? (def.on.length === 1 ? def.on[0] : undefined) : def.on;
  return on === undefined || on.startsWith('$') ? undefined : (on as Key);
}

export function prepareForm(task: Key, config: CompiledConfig, type?: Key): PreparedForm {
  let byTask = cache.get(config);
  if (!byTask) cache.set(config, (byTask = new Map()));
  const cacheKey = `${task}\0${type ?? ''}`;
  const hit = byTask.get(cacheKey);
  if (hit) return hit;
  const def = config.file.tasks?.[task];
  if (!def) throw new FormConfigError(task, `unknown task: ${task}`);
  const get = (field: string, attr: FormAttribute): TypedAst => {
    const found = config.expressions.get(kp('tasks', task, 'form', field, attr));
    if (!found) {
      throw new FormConfigError(
        task,
        `tasks.${task}.form.${field}.${attr} is declared but has no compiled expression`,
        field,
        attr,
      );
    }
    return found.typed;
  };
  const flag = (field: string, attr: 'required' | 'readonly', v: boolean | string | undefined): Flag =>
    v === undefined ? false : typeof v === 'boolean' ? v : get(field, attr);
  const target = targetType(def, type);
  const props = target === undefined ? undefined : config.file.types?.[target]?.properties;
  /** `<bind>.<property>`: the Objektart the bind expression was checked to yield, and the property on it. */
  const boundField = (key: string): Pick<PreparedField, 'bind' | 'property'> => {
    const dot = key.indexOf('.');
    if (dot < 0) return props?.[key] !== undefined ? { property: props[key] } : {};
    const name = key.slice(0, dot);
    const ty = config.expressions.get(kp('tasks', task, 'bind', name))?.typed.type;
    const type = ty?.kind === 'feature' ? (ty.type as Key) : undefined;
    if (type === undefined) return {};
    const property = key.slice(dot + 1);
    const p = config.file.types?.[type]?.properties[property];
    return { bind: { name: name as Key, type, property }, ...(p !== undefined && { property: p }) };
  };
  const formFields: PreparedField[] = Object.entries(def.form ?? {}).map(([key, f]) => {
    const relevant = f.relevant === undefined ? undefined : get(key, 'relevant');
    const constraint = f.constraint === undefined ? undefined : get(key, 'constraint');
    const calculate = f.calculate === undefined ? undefined : get(key, 'calculate');
    const choiceFilter = f.choice_filter === undefined ? undefined : get(key, 'choice_filter');
    const required = flag(key, 'required', f.required);
    const readonly = flag(key, 'readonly', f.readonly);
    const exprs = [relevant, constraint, calculate, choiceFilter, required, readonly].filter(
      (e): e is TypedAst => typeof e === 'object',
    );
    return {
      key: key as Key,
      required,
      readonly,
      calculatesNow: formReads(calculate ? [calculate.ast] : []).now,
      reads: formReads(exprs.map((e) => e.ast)),
      relevantReads: formReads(relevant ? [relevant.ast] : []),
      ...boundField(key),
      ...(relevant && { relevant }),
      ...(constraint && { constraint }),
      ...(f.constraint_message !== undefined && { constraintMessage: f.constraint_message }),
      ...(calculate && { calculate }),
      ...(choiceFilter && { choiceFilter, choiceReads: formReads([choiceFilter.ast]) }),
    };
  });
  // The fields in step order: the form's own, then the picked properties of quick-edit and location steps.
  const bare = (key: string, step: Exclude<TaskStepKind, 'form'>): PreparedField => ({
    key: key as Key,
    required: false,
    readonly: false,
    calculatesNow: false,
    reads: formReads([]),
    relevantReads: formReads([]),
    step,
    ...(props?.[key] !== undefined && { property: props[key] }),
  });
  const fields = stepsOf(def).flatMap((s): PreparedField[] =>
    s.kind === 'form'
      ? formFields
      : s.kind === 'quick_edit'
        ? s.properties.map((k) => bare(k, 'quick_edit'))
        : [bare(s.property, 'location')],
  );
  const prepared = {
    task,
    fields,
    calcOrder: orderCalculated(task, fields),
    relevanceOrder: orderRelevance(fields),
    typeKnown: target !== undefined || !(Array.isArray(def.on) && def.on.length > 1),
  };
  byTask.set(cacheKey, prepared);
  return prepared;
}
