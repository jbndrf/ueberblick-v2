/**
 * core.form: the ONE implementation of ODK form semantics (decision 0015, docs/05 tasks.form).
 * CONTRACT — written by the lead; changes need the lead. Consumed by plan (validating a run's input,
 * WP-041) and by packages/ui/src/form (the live form on the device) — neither re-implements
 * relevance, required, readonly, constraint or calculate (R1, course check 003).
 *
 * Pure: expressions are the compiled ones in `CompiledConfig.expressions` (key paths
 * `tasks.<task>.form.<field>.<attr>`), evaluated with expr.condition/evaluate. The caller supplies an
 * EvalContext without `form` and `value`; this module binds `form` (the current values) and `value`
 * (the field's own value) itself. `now` and `actor` come from the caller's context.
 */
import type { EvalContext, EvalError } from '../expr/contract';
import type { Json, Key } from '../model';
import type { FormFieldIssue, PropertyTypeKey, TaskStepKind } from '../registry';
import type { CompiledConfig } from '../schema/compile/contract';
import type { LocalizedString } from '../schema';
import type { Task } from '../schema/task';

type FormFieldEntry = NonNullable<Task['form']>[string];

export type FormValues = { readonly [field: string]: Json };

/** The expression-bearing attributes of a form field (docs/05 tasks.form). */
export type FormAttribute = keyof Pick<
  FormFieldEntry,
  'relevant' | 'required' | 'constraint' | 'calculate' | 'readonly' | 'choice_filter'
>;

export interface OfferedOption {
  readonly key: Key;
  readonly hint?: LocalizedString;
}

export interface FieldState {
  readonly key: Key;
  /** The step that owns the field; `form` for the task form. Quick-edit and location properties have no expressions. */
  readonly step: TaskStepKind;
  readonly relevant: boolean;
  readonly required: boolean;
  readonly readonly: boolean;
  /** The type of the property the field is bound to; `null` when the form binds no property (a `$none` task without `creates`). */
  readonly propertyType: PropertyTypeKey | null;
  /**
   * select/multiselect with a `choice_filter` only: the options offered now, in the property's order, each with its
   * optional explanation text (`option_hints`). Absent: every option of the property is offered. A value outside
   * this list has the `option` issue, and `submitValues` leaves it out (ODK clears an answer the filter removed).
   */
  readonly options?: readonly OfferedOption[];
  /**
   * A `<bind>.<property>` field (A-047): the bind and the Objektart whose property it shows. The renderer labels the
   * field's origin with that Objektart's name. Absent for a property of the task subject.
   */
  readonly bind?: { readonly name: Key; readonly type: Key };
  /**
   * select/multiselect with a `choice_filter` only: true while a field the filter reads is still empty, so the dependent
   * select has nothing to depend on yet (v3 shows "Zuerst einen Wert im abhängigen Feld auswählen" instead of the select).
   */
  readonly waitingForSource?: boolean;
  /** The value after calculate for readonly calculated fields; the input value otherwise. */
  readonly value: Json | undefined;
  /**
   * Errors of expressions that have no issue kind of their own (relevant, required, readonly,
   * calculate): each counted as false / no value and reported here (evaluation is total).
   */
  readonly errors: readonly { readonly attr: FormAttribute; readonly error: EvalError }[];
  readonly issues: readonly {
    readonly issue: FormFieldIssue;
    /** `constraint_message` for constraint failures. */
    readonly message?: LocalizedString;
    /** Set when an expression errored (evaluation is total: an error counts as false). */
    readonly error?: EvalError;
  }[];
}

export interface FormEvaluation {
  readonly task: Key;
  /** In form order. */
  readonly fields: readonly FieldState[];
  /** No relevant field has an issue. */
  readonly valid: boolean;
}

export interface FormApi {
  /**
   * Initial values for opening a task: `calculate` evaluated once against the current state (the
   * prefill), then `preset` values (role presets, an assistant's proposal) override. Never re-run
   * later for editable fields (the v3 prefill bug).
   */
  initial(task: Key, config: CompiledConfig, ctx: EvalContext, preset?: FormValues): FormValues;
  /** Evaluates every field for the given values. Deterministic; the same call is used by plan and ui. */
  evaluate(
    task: Key,
    config: CompiledConfig,
    values: FormValues,
    ctx: EvalContext,
    /**
     * The feature type the run targets, for the `type` issue. Defaults to `creates`, else the single
     * `on` type; required when `on` lists several types (else `FormConfigError`). A `$none` task
     * without `creates` has no properties to check against, so no `type` issues arise.
     */
    type?: Key,
  ): FormEvaluation;
  /** The values a run submits: non-relevant fields dropped, readonly calculated fields recomputed. */
  submitValues(evaluation: FormEvaluation): FormValues;
  /**
   * The non-relevant fields that `values` sends as an explicit null: a hidden field the participant confirmed to clear
   * (owner Q5). The caller writes the null only for a field that holds a value. A non-null value is never a clear.
   */
  hiddenClears(evaluation: FormEvaluation, values: FormValues): readonly Key[];
  /**
   * The fields to re-evaluate after `field` changed, in form order: `field` itself, every field whose
   * relevant/required/readonly/constraint/calculate reads `form.<field>`, and transitively the readers
   * of a readonly calculated field that changes with it. An expression that reads `form` as a whole
   * counts as reading every field (never too few).
   */
  dependents(task: Key, config: CompiledConfig, field: Key): readonly Key[];
}
