/**
 * The task view (docs/08 "Task"): a pure function of the Doc. A task is read as where it is offered
 * (`on`), when it is available (`when`, as chips where core can), the form (fields bound to
 * properties, ODK vocabulary) and the steps after the form (`then`). No DOM, so the lens, tests and
 * assistants share it (R1). Conditions are read by core's `toChips`; nothing is re-interpreted (R5).
 */
import {
  TASK_OFFERS,
  type Json,
  type LocalizedString,
  type Property,
  type PropertyTypeKey,
  type Provenance,
  type TemplateFile,
} from '@ueberblick/core';
import type { Doc } from '../../doc';
import { labelOf } from '../../shell/location';
import { conditionOf, type ConditionView } from '../../shell/conditions';

export type Offer = (typeof TASK_OFFERS.keys)[number];

/** Where a task is offered: one or more feature types, or a special offer (`$map`, `$none`). */
export type OnView =
  | { readonly kind: 'types'; readonly types: readonly string[] }
  | { readonly kind: 'offer'; readonly offer: Offer };

export interface FieldView {
  readonly key: string;
  /** The property's label (or the key). */
  readonly propertyLabel: string;
  /** Undefined when the feature type has no such property (a dangling field). */
  readonly propertyType?: PropertyTypeKey;
  readonly options: readonly string[];
  /** The form entry as the file has it. */
  readonly entry: FormEntry;
  readonly provenance: Provenance;
}

export type FormEntry = NonNullable<NonNullable<TemplateFile['tasks']>[string]['form']>[string];

export interface StepView {
  readonly index: number;
  readonly set: readonly { readonly key: string; readonly text: string; readonly value: Json }[];
  readonly when?: ConditionView;
  readonly otherwise: boolean;
}

export interface TaskView {
  readonly key: string;
  readonly label: string;
  readonly on: OnView;
  readonly creates?: string;
  readonly when?: ConditionView;
  /** The feature type the form and `then.set` address: the created type, else the first `on` type. */
  readonly formType?: string;
  readonly fields: readonly FieldView[];
  /** Properties of `formType` that are not in the form yet. */
  readonly addable: readonly { readonly key: string; readonly label: string }[];
  /** Every property of `formType`, for the keys of `then.set`. */
  readonly properties: readonly { readonly key: string; readonly label: string }[];
  readonly steps: readonly StepView[];
  /** Left-hand sides a condition can use: `self.<property>`, `form.<field>`, `actor.id`. */
  readonly paths: readonly string[];
  readonly provenance: Provenance;
}

const OFFERS = TASK_OFFERS.keys as readonly string[];

export const isOffer = (v: string): v is Offer => OFFERS.includes(v);

export function onView(on: string | readonly string[]): OnView {
  if (typeof on === 'string' && isOffer(on)) return { kind: 'offer', offer: on };
  return { kind: 'types', types: typeof on === 'string' ? [on] : on };
}

/** A `set` value as text: a string is an expression as written, other scalars as JSON. */
export const valueText = (v: Json): string => (typeof v === 'string' ? v : JSON.stringify(v));

/** Typed text as a `set` value: `true`, `false`, `null` and numbers stay literals (same meaning as the expression), the rest is an expression. */
export function textValue(text: string): Json {
  const t = text.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  return t !== '' && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}

const optionsOf = (p: Property | undefined): readonly string[] =>
  p?.options === undefined ? [] : Object.keys(p.options);

const propLabel = (p: Property | undefined, locale: string, key: string): string =>
  labelOf(p?.label as LocalizedString | undefined, locale, key);

export function buildTask(doc: Doc, key: string, locale: string): TaskView | undefined {
  const file = doc.effective();
  const task = file.tasks?.[key];
  if (task === undefined) return undefined;
  const on = onView(task.on);
  const onTypes = on.kind === 'types' ? on.types : [];
  const formType = task.creates ?? onTypes[0];
  const props = formType === undefined ? {} : (file.types?.[formType]?.properties ?? {});
  const form = task.form ?? {};
  const selfProps = onTypes[0] === undefined ? {} : (file.types?.[onTypes[0]]?.properties ?? {});
  return {
    key,
    label: labelOf(task.label, locale, key),
    on,
    ...(task.creates !== undefined ? { creates: task.creates } : {}),
    ...(task.when !== undefined ? { when: conditionOf(task.when) } : {}),
    ...(formType !== undefined ? { formType } : {}),
    fields: Object.entries(form).map(([k, entry]): FieldView => {
      const p = props[k];
      return {
        key: k,
        propertyLabel: propLabel(p, locale, k),
        ...(p !== undefined ? { propertyType: p.type } : {}),
        options: optionsOf(p),
        entry,
        provenance: doc.provenance(`tasks.${key}.form.${k}`),
      };
    }),
    addable: Object.entries(props)
      .filter(([k]) => form[k] === undefined)
      .map(([k, p]) => ({ key: k, label: propLabel(p, locale, k) })),
    properties: Object.entries(props).map(([k, p]) => ({ key: k, label: propLabel(p, locale, k) })),
    steps: (task.then ?? []).map((s, index): StepView => ({
      index,
      set: Object.entries(s.set ?? {}).map(([k, v]) => ({ key: k, text: valueText(v), value: v })),
      ...(s.when !== undefined ? { when: conditionOf(s.when) } : {}),
      otherwise: s.otherwise === true,
    })),
    paths: [
      ...Object.keys(selfProps).map((k) => `self.${k}`),
      ...Object.keys(form).map((k) => `form.${k}`),
      'actor.id',
    ],
    provenance: doc.provenance(`tasks.${key}`),
  };
}
