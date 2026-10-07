import { formApi, isEmptyValue, type FieldState, type FormEvaluation } from '@ueberblick/core/form';
import type { FeatureId, Json as CoreJson, Key } from '@ueberblick/core/model';
import type {
  ClearedField,
  FieldIssue,
  FormField,
  FormModel,
  FormSession,
  Json,
  SessionOptions,
  TypeFault,
} from './contract';
import { localize } from './localize';

/** core.form works on readonly JSON; the renderer's `Json` is the same data with mutable arrays. */
const fromCore = (v: CoreJson | undefined): Json | undefined => v as Json | undefined;

/** Which bound a value broke, for the message of a core `type` issue. */
function typeFault(f: FormField, v: Json | undefined): TypeFault | undefined {
  if (typeof v !== 'number') return undefined;
  if (f.integer && !Number.isInteger(v)) return 'integer';
  if (f.min !== undefined && v < f.min) return 'min';
  if (f.max !== undefined && v > f.max) return 'max';
  return undefined;
}

/** The state of one open form: values and a cached evaluation. Every rule (relevance, required,
 * readonly, constraint, calculate, submit) comes from `core.form` (R1). No I/O: `draft()` hands the
 * values to whoever keeps the draft. */
export function createFormSession(model: FormModel, options: SessionOptions): FormSession {
  const { task, config, ctx, type } = options;
  let locale = options.locale ?? 'en';
  const values: Record<string, CoreJson> = { ...formApi.initial(task, config, ctx, options.initial) };
  const listeners = new Set<() => void>();
  const byKey = new Map(model.fields.map((f) => [f.key, f]));
  const everyKey = Array.from(byKey.keys()) as Key[];
  let cached: FormEvaluation | undefined;
  let states = new Map<string, FieldState>();

  const field = (key: string): FormField => {
    const f = byKey.get(key);
    if (!f) throw new Error(`unknown form field: ${key}`);
    return f;
  };

  /** Evaluates the form. A readonly calculated field among `changed` is adopted into `values` (its
   * stale value would otherwise read as an edit), then the form is evaluated once more. */
  function run(changed: readonly Key[]): FormEvaluation {
    let ev = formApi.evaluate(task, config, values, ctx, type);
    let moved = false;
    for (const s of ev.fields) {
      if (!changed.includes(s.key) || !s.readonly || s.value === values[s.key]) continue;
      if (s.value === undefined) Reflect.deleteProperty(values, s.key);
      else values[s.key] = s.value;
      moved = true;
    }
    if (moved) ev = formApi.evaluate(task, config, values, ctx, type);
    return sweep(ev);
  }

  // Fields the user has edited: only an edit can "actively empty" a stored value.
  const touched = new Set<string>();

  /** An answer the `choice_filter` no longer offers is cleared at once (ODK) and counts as an edit, so a stored
   * value it erases is listed in the "Felder werden geleert" warning before the submit (owner Q5). */
  function sweep(ev: FormEvaluation): FormEvaluation {
    const gone = ev.fields.filter((s) => s.relevant && s.issues.some((i) => i.issue === 'option'));
    if (gone.length === 0) return ev;
    for (const s of gone) {
      Reflect.deleteProperty(values, s.key);
      touched.add(s.key);
    }
    return run(everyKey);
  }

  function store(ev: FormEvaluation): FormEvaluation {
    cached = ev;
    states = new Map(ev.fields.map((s) => [s.key, s]));
    return ev;
  }
  const evaluation = (): FormEvaluation => cached ?? store(run(everyKey));
  const stateOf = (key: string): FieldState => {
    field(key);
    evaluation();
    return states.get(key) as FieldState;
  };

  const isRelevant = (key: string): boolean => stateOf(key).relevant;
  const isRequired = (key: string): boolean => stateOf(key).required;
  const isReadonly = (key: string): boolean => stateOf(key).readonly;
  const offered = (key: string): readonly string[] | undefined => stateOf(key).options?.map((o) => o.key);
  const waitingForSource = (key: string): boolean => stateOf(key).waitingForSource === true;

  const visibleFields = (page: number): readonly FormField[] =>
    (model.pages[page] ?? []).filter((f) => isRelevant(f.key));

  const check = (f: FormField): FieldIssue[] => {
    const at = (kind: FieldIssue['kind'], message?: string, fault?: TypeFault): FieldIssue => ({
      fieldKey: f.key,
      fieldId: f.id,
      kind,
      ...(message !== undefined && { message }),
      ...(fault !== undefined && { fault }),
    });
    const out = stateOf(f.key).issues.map((i) => {
      if (i.issue === 'constraint') {
        return at('constraint', i.message ? localize(i.message, locale) : undefined);
      }
      if (i.issue === 'type') return at('type', undefined, typeFault(f, fromCore(values[f.key])));
      return at(i.issue);
    });
    return out;
  };

  const self = ctx.vars.get('self');
  const selfId = typeof self === 'object' && self !== null && '$feature' in self ? self.$feature : undefined;
  const stored = (key: string): CoreJson | undefined =>
    selfId === undefined ? undefined : ctx.features.property(selfId as FeatureId, key);

  // O(form fields), and only when the user taps submit.
  function clearing(): readonly ClearedField[] {
    return model.fields
      .filter((f) => {
        if (isEmptyValue(stored(f.key))) return false;
        return !isRelevant(f.key) || (touched.has(f.key) && isEmptyValue(values[f.key]));
      })
      .map((f) => ({ key: f.key, label: localize(f.label, locale) }));
  }

  /** A computed property is never submitted: the engine computes it (v3 FieldRenderer.svelte:644). */
  const withoutComputed = (v: Record<string, Json>): Record<string, Json> =>
    Object.fromEntries(Object.entries(v).filter(([k]) => !byKey.get(k)?.computed));

  const validatePage = (page: number): FieldIssue[] => visibleFields(page).flatMap(check);

  return {
    model,
    get locale() {
      return locale;
    },
    setLocale: (next) => {
      if (next === locale) return;
      locale = next;
      for (const fn of [...listeners]) fn();
    },
    draft: () => ({ ...values }) as Record<string, Json>,
    submitValues: () => withoutComputed(formApi.submitValues(evaluation()) as Record<string, Json>),
    clearing,
    submitValuesCleared: () => ({
      ...withoutComputed(formApi.submitValues(evaluation()) as Record<string, Json>),
      ...Object.fromEntries(
        clearing()
          .filter((c) => !byKey.get(c.key)?.computed)
          .map((c) => [c.key, null]),
      ),
    }),
    get: (key) => fromCore(values[key]),
    set: (key, value) => {
      field(key);
      values[key] = value;
      touched.add(key);
      // Only the field and the fields that read it can change state (core.form `dependents`).
      store(run(formApi.dependents(task, config, key as Key)));
      for (const fn of [...listeners]) fn();
    },
    isRelevant,
    isRequired,
    isReadonly,
    offered,
    waitingForSource,
    visibleFields,
    validatePage,
    validateAll: () => model.pages.flatMap((_, i) => validatePage(i)),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
