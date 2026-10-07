// The form renderer contract (WP-520). Written first; the session and components implement it.
import type { Snippet } from 'svelte';
import {
  defineRegistry,
  type KeyOf,
  type FormFieldIssue,
  type PropertyDisplayColumn,
  type PropertyTypeKey,
} from '@ueberblick/core/registry';
import type { CompiledConfig, JsonValue, Key, LocalizedString, Property, Task } from '@ueberblick/core/model';
import type { EvalContext } from '@ueberblick/core/expr';

export type Json = JsonValue;

/** The kinds of input the renderer draws. R6: enum values live in a registry. */
export const INPUT_KINDS = defineRegistry([
  { key: 'text', description: 'A single-line text input.' },
  { key: 'localized_text', description: 'A text input that edits one locale of a localized value.' },
  { key: 'number', description: 'A numeric input.' },
  { key: 'checkbox', description: 'A single checkbox.' },
  { key: 'date', description: 'A date input.' },
  { key: 'datetime', description: 'A date and time input.' },
  { key: 'time', description: 'A time-of-day input.' },
  { key: 'select', description: 'One option of a fixed set.' },
  { key: 'multiselect', description: 'Several options of a fixed set.' },
  { key: 'choice', description: 'One of caller-supplied choices (participant, reference).' },
  { key: 'tool', description: 'A tool slot: the tool produces the value (file, geometry).' },
] as const);
export type InputKind = KeyOf<typeof INPUT_KINDS>;

/** Typed errors of building a form model. An unknown type is never rendered as a blank. */
export const FORM_ERROR_CODES = defineRegistry([
  { key: 'unknown_property_type', description: 'A property type has no input.' },
  { key: 'unknown_property', description: 'A form field names a property the feature type lacks.' },
] as const);
export type FormErrorCode = KeyOf<typeof FORM_ERROR_CODES>;

export class FormModelError extends Error {
  constructor(
    readonly code: FormErrorCode,
    readonly fieldKey: string,
    message: string,
  ) {
    super(message);
    this.name = 'FormModelError';
  }
}

/** One option of a participant or reference field. */
export interface Choice {
  readonly value: string;
  readonly label: string;
}

/** One field of the form: the task's form entry joined with its property. */
export interface FormField {
  /** Property key; also the key in the submitted values. */
  readonly key: string;
  /** DOM id, stable per field. */
  readonly id: string;
  readonly type: PropertyTypeKey;
  readonly input: InputKind;
  readonly label: LocalizedString;
  readonly description?: LocalizedString;
  /** The grey hint of an empty input (v3 `placeholder`). */
  readonly placeholder?: LocalizedString;
  /** The Objektart of the bound Objekt this field edits (`<bind>.<property>`, A-047); the renderer labels the field with it. */
  readonly origin?: LocalizedString;
  readonly appearance: readonly string[];
  /** Key of the tool that produces the value (rendered in the tool slot). */
  readonly tool?: string;
  /** select/multiselect option keys with their labels. */
  readonly options?: Readonly<Record<string, LocalizedString>>;
  /** select/multiselect: the explanation text under an option, by option key (the property's `option_hints`). */
  readonly optionHints?: Readonly<Record<string, LocalizedString>>;
  readonly accept?: readonly string[];
  /** file: the property's `max_files`. */
  readonly maxFiles?: number;
  readonly min?: number;
  readonly max?: number;
  /** integer: only whole numbers. */
  readonly integer: boolean;
  /** participant/reference with `cardinality: many` ("Mehrfachauswahl"): the choice input picks several and holds a list of ids. */
  readonly multiple?: boolean;
  /** The property is computed by an expression (`computed`): drawn read-only, never submitted (v3 `write_mode: computed`). */
  readonly computed?: true;
  /** Where the field sits in its line (the form entry's `column`, A-049; v3 `column_position`). Absent: full width. */
  readonly column?: PropertyDisplayColumn;
  /** The line (the form entry's `row`, A-049; v3 `row_index`): neighbours with the same row share a line. Absent: a line of its own. */
  readonly row?: number;
}

/** The title and description of one page (v3 `FormPage`), from the form entry that starts it. */
export interface PageInfo {
  readonly title?: LocalizedString;
  readonly description?: LocalizedString;
}

/** Fields grouped into pages: one page unless a form entry carries `page` (it starts a page at its field). */
export interface FormModel {
  readonly fields: readonly FormField[];
  readonly pages: readonly (readonly FormField[])[];
  /** One entry per page, the same order as `pages`. */
  readonly pageInfo: readonly PageInfo[];
}

export interface BuildFormInput {
  readonly form: NonNullable<Task['form']>;
  /** The properties of the task's feature type. */
  readonly properties: Readonly<Record<string, Property>>;
  /**
   * For each bind a `<bind>.<property>` form key names: the label and the properties of the Objektart it yields (A-047).
   * A bind field without its entry is a `FormModelError`.
   */
  readonly bound?: Readonly<
    Record<
      string,
      { readonly label: LocalizedString; readonly properties: Readonly<Record<string, Property>> }
    >
  >;
  /**
   * Values a map step already holds, by property (the pin or the drawing of the + flow, a moved position). A geometry
   * property among them is no row of the form: v3 never showed the geometry as a field, the map sets it (WP-697).
   * The value still travels with the run, as the session's `initial`.
   */
  readonly placed?: Readonly<Record<string, Json>>;
}

export interface SessionOptions {
  /** The task whose `form:` the session runs. All form semantics come from `core.form` (R1). */
  readonly task: Key;
  readonly config: CompiledConfig;
  /** `self`, `actor`, `now` and the ports for expressions; `form` and `value` are bound by core.form. */
  readonly ctx: EvalContext;
  /** The feature type the run targets; needed when the task is offered on several types. */
  readonly type?: Key;
  /** Initial values from any source: a draft, an assistant proposal (H4), a role preset (H3). */
  readonly initial?: Readonly<Record<string, Json>>;
  /** Language used to pick a `LocalizedString`. */
  readonly locale?: string;
}

/** Why a `type` issue arose, for a precise message. Presentation only: core.form decides validity. */
export const TYPE_FAULTS = defineRegistry([
  { key: 'min', description: 'Below the property minimum.' },
  { key: 'max', description: 'Above the property maximum.' },
  { key: 'integer', description: 'Not a whole number.' },
] as const);
export type TypeFault = KeyOf<typeof TYPE_FAULTS>;

export interface FieldIssue {
  readonly fieldKey: string;
  readonly fieldId: string;
  /** The issue kind of core.form (registry `FORM_FIELD_ISSUES`). */
  readonly kind: FormFieldIssue;
  /** For a `type` issue: which bound or rule the value broke, when known. */
  readonly fault?: TypeFault;
  /** The localized `constraint_message` for `constraint`. */
  readonly message?: string;
}

/** A stored value that submitting would erase: a now-hidden field, or one the user emptied (owner Q5). */
export interface ClearedField {
  readonly key: string;
  readonly label: string;
}

export interface FormSession {
  readonly model: FormModel;
  readonly locale: string;
  /** A runtime language switch (WP-790): the open form re-labels, the values stay. Notifies subscribers. */
  setLocale(locale: string): void;
  /** Current values, including hidden fields (for a draft). */
  draft(): Record<string, Json>;
  /** Values to submit: only relevant fields (decision 0015). */
  submitValues(): Record<string, Json>;
  get(key: string): Json | undefined;
  /** A user edit. `calculate` prefills only once, so an edit is never overwritten. */
  set(key: string, value: Json): void;
  isRelevant(key: string): boolean;
  isRequired(key: string): boolean;
  isReadonly(key: string): boolean;
  /**
   * The option keys the field offers now (its form entry's `choice_filter`, evaluated by core.form), or
   * undefined when it has no filter: then every option of `field.options` is offered.
   */
  offered(key: string): readonly string[] | undefined;
  /** A filtered select whose source field is still empty: the form shows a hint instead of the select (v3 smart_dropdown). */
  waitingForSource(key: string): boolean;
  /** The fields whose stored value this submit would erase. The caller warns before it submits (v3 "Felder werden geleert"). */
  clearing(): readonly ClearedField[];
  /** `submitValues` plus an explicit `null` for each field of `clearing()`: the submit after the warning. */
  submitValuesCleared(): Record<string, Json>;
  /** Relevant fields of a page. */
  visibleFields(page: number): readonly FormField[];
  /** Issues of the relevant fields of one page. */
  validatePage(page: number): FieldIssue[];
  /** Issues of every page, in page order. */
  validateAll(): FieldIssue[];
  subscribe(fn: () => void): () => void;
}

export interface ToolSlot {
  field: FormField;
  value: Json | undefined;
  set: (value: Json) => void;
  id: string;
}

export interface FormRendererProps {
  session: FormSession;
  /** Called with the values to submit once every page validates (and any clearing is confirmed). While a returned
   * promise is pending the form is submitting: the buttons are disabled and Absenden shows "Wird gesendet…". */
  onsubmit: (values: Record<string, Json>) => void | Promise<void>;
  /** The footer's "Abbrechen" on the first page. Without it the button is not drawn. */
  oncancel?: () => void;
  /** The label of that button (default "Abbrechen"): a step after the first says "Zurück". */
  cancelLabel?: string;
  /** The label of the last page's button (default "Absenden"): a step that is not the last says "Weiter". */
  submitLabel?: string;
  /** The submit button continues to a further step (chevron) instead of sending (paper plane). */
  continues?: boolean;
  /** Called with the draft after each change, if the caller wants to keep one. */
  ondraft?: (values: Record<string, Json>) => void;
  /** Options for participant and reference fields, by field key. */
  choices?: Readonly<Record<string, readonly Choice[]>>;
  /** Renders the tool for a field with a `tool` key, and file and geometry fields. */
  tool?: Snippet<[ToolSlot]>;
  /** The record view (a past run's Protokoll): every input is `aria-readonly` (never `disabled`), a choice shows its
   * labels as text, and there is no submit, cancel, error summary or clearing dialog. Page navigation stays.
   * Absent: the form behaves as before. */
  readonly?: boolean;
}
