/**
 * core.form: the one implementation of ODK form semantics (decision 0015, contract in `./contract`).
 * Relevance, required, readonly, constraint and calculate are evaluated here and nowhere else (R1).
 */
import { condition, evaluate as evaluateExpr } from '../expr/evaluate';
import type { EvalContext, EvalError, EvalValue } from '../expr/contract';
import type { TypedAst } from '../expr/check/check';
import type { FeatureId, Json, Key } from '../model';
import type { CompiledConfig } from '../schema/compile/contract';
import type {
  FieldState,
  OfferedOption,
  FormApi,
  FormAttribute,
  FormEvaluation,
  FormValues,
} from './contract';
import { isEmptyValue } from './empty';
import { typedForProperty } from './datetime';
import { typeFits } from './type';
import { FormConfigError, prepareForm, type Flag, type PreparedField } from './prepare';

export type * from './contract';
export { FormConfigError };
export { fileAccepted } from './type';
export { isEmptyValue } from './empty';
export { localToInstant, instantToLocal } from './datetime';
/** The steps a task runs, in order (WP-636): the participant code takes it from here, not from the schema barrel. */
export { stepsOf } from '../schema/steps-of';

type Form = Record<string, Json>;

/** Deep equality of JSON values; object key order does not matter. */
function deepEqual(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const oa = a as { readonly [k: string]: Json };
  const ob = b as { readonly [k: string]: Json };
  const keys = Object.keys(oa);
  return (
    keys.length === Object.keys(ob).length &&
    keys.every((k) => Object.hasOwn(ob, k) && deepEqual(oa[k], ob[k]))
  );
}

export function sameJson(a: Json | undefined, b: Json | undefined): boolean {
  return (isEmptyValue(a) && isEmptyValue(b)) || deepEqual(a, b);
}

/** A feature reference is stored as its id; lists convert element-wise. */
function toJson(v: EvalValue): Json {
  if (Array.isArray(v)) return v.map(toJson);
  if (typeof v === 'object' && v !== null && '$feature' in v) return v.$feature as string;
  return v as Json;
}

/** The caller's context with `form` and (for a field) `value` bound. */
function bind(ctx: EvalContext, form: Form, value?: Json | undefined, option?: string): EvalContext {
  const vars = new Map(ctx.vars);
  vars.set('form', form);
  vars.set('value', value ?? null);
  if (option !== undefined) vars.set('option', option);
  return { ...ctx, vars };
}

type Errors = { attr: FormAttribute; error: EvalError }[];

function test(expr: TypedAst, ctx: EvalContext, attr: FormAttribute, errors: Errors): boolean {
  const r = condition(expr, ctx);
  if (r.error) errors.push({ attr, error: r.error });
  return r.value;
}

function flag(f: Flag, ctx: EvalContext, attr: FormAttribute, errors: Errors): boolean {
  return typeof f === 'boolean' ? f : test(f, ctx, attr, errors);
}

/** The options a `choice_filter` offers right now, in the property's order. One evaluation per option (F5, R1). */
function offered(f: PreparedField, form: Form, ctx: EvalContext, errors: Errors): readonly OfferedOption[] {
  const filter = f.choiceFilter as TypedAst;
  const hints = f.property?.option_hints ?? {};
  return Object.keys(f.property?.options ?? {})
    .filter((k) => test(filter, bind(ctx, form, form[f.key], k), 'choice_filter', errors))
    .map((k) => ({ key: k as Key, ...(hints[k] !== undefined && { hint: hints[k] }) }));
}

/** Answers outside the offered options (a select holds a key, a multiselect a list of keys). */
function outside(value: Json | undefined, offer: readonly OfferedOption[]): boolean {
  if (isEmptyValue(value)) return false;
  const keys = new Set<string>(offer.map((o) => o.key));
  return Array.isArray(value) ? value.some((v) => !keys.has(String(v))) : !keys.has(String(value));
}

function calculate(f: PreparedField, ctx: EvalContext, errors: Errors): { value: Json } | undefined {
  if (!f.calculate) return undefined;
  const r = evaluateExpr(f.calculate, ctx);
  if (!r.ok) {
    errors.push({ attr: 'calculate', error: r.error });
    return undefined;
  }
  return { value: typedForProperty(f.property?.type, toJson(r.value)) };
}

/** The Objekt a bind field edits, when it is on the device (a bind that yields none, or a gone one: no field). */
function boundId(f: PreparedField, ctx: EvalContext): FeatureId | undefined {
  if (f.bind === undefined) return undefined;
  const v = ctx.vars.get(f.bind.name);
  if (v === null || typeof v !== 'object' || !('$feature' in v)) return undefined;
  const id = v.$feature as FeatureId;
  return ctx.features.type(id) === undefined ? undefined : id;
}

function initial(task: Key, config: CompiledConfig, ctx: EvalContext, preset?: FormValues): FormValues {
  const form: Form = { ...preset };
  for (const f of prepareForm(task, config).fields) {
    if (preset && f.key in preset) continue;
    if (f.calculate) {
      const r = calculate(f, bind(ctx, form, form[f.key]), []);
      if (r && r.value !== null) form[f.key] = r.value;
    } else if (f.bind !== undefined) {
      // A bind field starts at the bound Objekt's current value (A-047); a missing Objekt leaves it empty.
      const id = boundId(f, ctx);
      const v = id === undefined ? undefined : ctx.features.property(id, f.bind.property);
      if (v !== undefined && v !== null) form[f.key] = v;
    }
  }
  return form;
}

function evaluate(
  task: Key,
  config: CompiledConfig,
  values: FormValues,
  ctx: EvalContext,
  type?: Key,
): FormEvaluation {
  const { fields, calcOrder, relevanceOrder, typeKnown } = prepareForm(task, config, type);
  if (!typeKnown) {
    throw new FormConfigError(task, `task ${task} is offered on several types: pass the target type`);
  }
  const form: Form = { ...values };
  const errors = new Map<string, Errors>(fields.map((f) => [f.key, []]));
  const readonlyOf = new Map<string, boolean>();
  const computed = new Set<string>();

  // Pass 1: readonly calculated fields follow their inputs, in form order. Editable ones never do.
  for (const f of calcOrder) {
    const errs = errors.get(f.key) as Errors;
    const ro = flag(f.readonly, bind(ctx, form, form[f.key]), 'readonly', errs);
    readonlyOf.set(f.key, ro);
    if (!ro) continue;
    computed.add(f.key);
    const r = calculate(f, bind(ctx, form, form[f.key]), errs);
    if (r) form[f.key] = r.value;
    else Reflect.deleteProperty(form, f.key);
  }

  // Pass 2a: relevance in dependency order. A non-relevant field is dropped from the values every later
  // expression sees (the ODK cascade), so a reader of it finds it empty.
  const seen: Form = { ...form };
  const relevantOf = new Map<string, boolean>();
  for (const f of relevanceOrder) {
    const errs = errors.get(f.key) as Errors;
    // A bind field whose Objekt is missing (or not on the device) is not relevant: not shown, not written.
    const r =
      (f.bind === undefined || boundId(f, ctx) !== undefined) &&
      (f.relevant === undefined || test(f.relevant, bind(ctx, seen, seen[f.key]), 'relevant', errs));
    relevantOf.set(f.key, r);
    if (!r) Reflect.deleteProperty(seen, f.key);
  }

  // Pass 2a': a field with a `choice_filter` offers its options over the values the earlier fields left, in form
  // order (a chain of dependent dropdowns). An answer outside the offer is removed like a non-relevant one.
  const offers = new Map<string, readonly OfferedOption[]>();
  const removed = new Set<string>();
  for (const f of fields) {
    if (!f.choiceFilter || relevantOf.get(f.key) === false) continue;
    const errs = errors.get(f.key) as Errors;
    const offer = offered(f, seen, ctx, errs);
    offers.set(f.key, offer);
    if (outside(form[f.key], offer)) {
      removed.add(f.key);
      Reflect.deleteProperty(seen, f.key);
    }
  }

  // Pass 2b: state per field over the final values.
  const states: FieldState[] = fields.map((f) => {
    const errs = errors.get(f.key) as Errors;
    const fctx = bind(ctx, seen, form[f.key]);
    const relevant = relevantOf.get(f.key) ?? true;
    const required = flag(f.required, fctx, 'required', errs);
    const ro = readonlyOf.get(f.key) ?? flag(f.readonly, fctx, 'readonly', errs);
    const value = form[f.key];
    const issues: FieldState['issues'][number][] = [];
    if (f.step !== undefined) {
      // Quick edit and location touch only what the participant submits; a required property cannot be emptied.
      if (Object.hasOwn(values, f.key)) {
        if (isEmptyValue(value)) {
          if (f.property?.required === true) issues.push({ issue: 'required' });
        } else if (f.property && !typeFits(f.property, value as Json)) issues.push({ issue: 'type' });
      }
    } else if (relevant) {
      // A calculate that reads `now` differs between device and server by design: the recomputed value wins.
      if (
        computed.has(f.key) &&
        !f.calculatesNow &&
        values[f.key] !== undefined &&
        !sameJson(values[f.key], value)
      ) {
        issues.push({ issue: 'readonly' });
      } else if (isEmptyValue(value)) {
        if (required) issues.push({ issue: 'required' });
      } else if (f.property && !typeFits(f.property, value as Json)) {
        issues.push({ issue: 'type' });
      } else if (removed.has(f.key)) {
        issues.push({ issue: 'option' });
      } else if (f.constraint) {
        const cErrs: Errors = [];
        if (!test(f.constraint, fctx, 'constraint', cErrs)) {
          issues.push({
            issue: 'constraint',
            ...(f.constraintMessage !== undefined && { message: f.constraintMessage }),
            ...(cErrs[0] && { error: cErrs[0].error }),
          });
        }
      }
    }
    return {
      key: f.key,
      step: f.step ?? 'form',
      relevant,
      required,
      readonly: ro,
      propertyType: f.property?.type ?? null,
      ...(f.bind !== undefined && { bind: { name: f.bind.name, type: f.bind.type } }),
      ...(offers.has(f.key) && { options: offers.get(f.key) as readonly OfferedOption[] }),
      ...(f.choiceReads !== undefined && {
        waitingForSource: [...f.choiceReads.fields].some((k) => k !== f.key && isEmptyValue(form[k])),
      }),
      value,
      errors: errs,
      issues,
    };
  });
  return { task, fields: states, valid: states.every((s) => !s.relevant || s.issues.length === 0) };
}

function submitValues(evaluation: FormEvaluation): FormValues {
  const out: Form = {};
  for (const f of evaluation.fields) {
    if (f.relevant && f.value !== undefined && !f.issues.some((i) => i.issue === 'option'))
      out[f.key] = f.value;
  }
  return out;
}

/**
 * The hidden fields the participant confirmed to clear (owner Q5, v3 "Felder werden geleert"): non-relevant fields
 * the submitted values carry as an explicit null. Only the caller knows what is stored, so it keeps those that hold a
 * value. A non-null value for a non-relevant field is never a clear.
 */
function hiddenClears(evaluation: FormEvaluation, values: FormValues): readonly Key[] {
  return evaluation.fields
    .filter((f) => !f.relevant && Object.hasOwn(values, f.key) && values[f.key] === null)
    .map((f) => f.key);
}

function dependents(task: Key, config: CompiledConfig, field: Key): readonly Key[] {
  const { fields } = prepareForm(task, config);
  const hit = new Set<string>([field]);
  const queue: string[] = [field];
  while (queue.length > 0) {
    const changed = queue.pop() as string;
    for (const f of fields) {
      if (hit.has(f.key) || !(f.reads.all || f.reads.fields.has(changed))) continue;
      hit.add(f.key);
      // A readonly calculated field changes its value with its inputs, and a field whose `relevant` reads
      // the change may drop out (the cascade), so its own readers change too. Nothing else propagates.
      const cascades =
        f.relevant !== undefined && (f.relevantReads.all || f.relevantReads.fields.has(changed));
      // A field with a `choice_filter` may lose its answer, so its own readers change too.
      if ((f.calculate && f.readonly !== false) || cascades || f.choiceFilter !== undefined)
        queue.push(f.key);
    }
  }
  return fields.filter((f) => hit.has(f.key)).map((f) => f.key);
}

export const formApi: FormApi = { initial, evaluate, submitValues, hiddenClears, dependents };
