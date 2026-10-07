/**
 * What the field panel (v3 `FieldConfigPanel`, Darstellung) shows and writes for one field of a task's form, as
 * pure functions over the effective file and WP-200 ops: no DOM, so the panel, the tests and an assistant (H4)
 * share them (R1). Form-local settings write the form entry (`tasks.<t>.form.<p>`: `placeholder`, `required`,
 * `calculate`, `constraint`), the help text writes the property's `description`: the engine has no per-form hint
 * and the participant's form shows that description (WP-672, register E14).
 */
import {
  formatKeyPath,
  localizeExact,
  type Json,
  type LocalizedString,
  type Property,
  type PropertyTypeKey,
  type TemplateFile,
} from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { clearOps, setFieldAttrOps, setOps, withLocalized } from '../../lenses/task/edit';
import { literalText, parseLiteral } from '../../shell/conditions/chips';
import type { Translate } from '../../shell/messages';
import {
  constraintOf,
  isValidStep,
  mergeRules,
  patternProblem,
  parseConstraint,
  type ParsedConstraint,
  type Rules,
  type RulesPatch,
} from './constraint';
import { formOf } from './model';

/** v3 `ValueSource` kinds (`workflow-model/value-source.ts`): what a field starts with. */
export const PREFILL_KINDS = ['empty', 'constant', 'last_value', 'computed'] as const;
export type PrefillKind = (typeof PREFILL_KINDS)[number];

/** A prefill as the panel edits it: the kind, and the typed constant or the expression. */
export interface Prefill {
  readonly kind: PrefillKind;
  readonly text: string;
}

/** Reads `calculate` back: `self.<key>` is "last value", a literal a constant, anything else an expression. */
export function prefillOf(calculate: string | undefined, key: string): Prefill {
  if (calculate === undefined) return { kind: 'empty', text: '' };
  if (calculate === `self.${key}`) return { kind: 'last_value', text: '' };
  const literal = parseLiteral(calculate);
  if (literal.ok && literal.value !== null && typeof literal.value !== 'object')
    return { kind: 'constant', text: String(literal.value) };
  return { kind: 'computed', text: calculate };
}

/** The constant a typed text means for a property type: a number for number and integer, true/false for boolean. */
function constantOf(text: string, type: PropertyTypeKey | undefined): Json {
  if ((type === 'number' || type === 'integer') && text.trim() !== '' && Number.isFinite(Number(text)))
    return Number(text);
  if (type === 'boolean' && (text === 'true' || text === 'false')) return text === 'true';
  return text;
}

/** The `calculate` source of a prefill; `undefined` for an empty prefill and for one whose text is still empty. */
export function calculateOf(
  prefill: Prefill,
  key: string,
  type: PropertyTypeKey | undefined,
): string | undefined {
  switch (prefill.kind) {
    case 'empty':
      return undefined;
    case 'last_value':
      return `self.${key}`;
    case 'constant':
      return prefill.text === '' ? undefined : literalText(constantOf(prefill.text, type));
    case 'computed':
      return prefill.text.trim() === '' ? undefined : prefill.text.trim();
  }
}

/** v3 "Mit aktuellem Datum/Uhrzeit vorausfüllen": the prefill `today()` of a date, `now` of a point in time; none for the others. */
export function nowSource(type: PropertyTypeKey | undefined): string | undefined {
  return type === 'date' ? 'today()' : type === 'datetime' ? 'now' : undefined;
}

export interface FieldConfig {
  readonly key: string;
  readonly property: Property | undefined;
  readonly placeholder: string;
  readonly help: string;
  /** The form entry's `required` when it is an expression; `required` is then true. */
  readonly requiredExpr: string | undefined;
  readonly required: boolean;
  /** The property is required itself (Felddefinition): the form cannot relax it. */
  readonly requiredByProperty: boolean;
  readonly calculate: string | undefined;
  readonly prefill: Prefill;
  readonly constraint: ParsedConstraint;
  readonly computed: boolean;
}

const text = (v: unknown, locale: string): string =>
  v === undefined || v === null || (typeof v !== 'string' && typeof v !== 'object')
    ? ''
    : localizeExact(v as LocalizedString, locale);

export function fieldConfigOf(
  file: TemplateFile,
  task: string,
  type: string,
  key: string,
  locale: string,
): FieldConfig {
  const entry = formOf(file, task)[key] ?? {};
  const property = file.types?.[type]?.properties[key];
  const calculate = entry.calculate;
  return {
    key,
    property,
    placeholder: text(entry.placeholder, locale),
    help: text(property?.description, locale),
    requiredExpr: typeof entry.required === 'string' ? entry.required : undefined,
    required: entry.required === true || typeof entry.required === 'string',
    requiredByProperty: property?.required === true,
    calculate,
    prefill: prefillOf(calculate, key),
    constraint: parseConstraint(entry.constraint, calculate),
    computed: property?.computed !== undefined,
  };
}

/** The text of a constraint's message, from the rules (the builder's words, in the builder's language). */
export function ruleMessage(rules: Rules, t: Translate, type: PropertyTypeKey | undefined): string {
  const unit = type === 'multiselect' ? 'choices' : 'chars';
  const parts: string[] = [];
  if (rules.minLength !== undefined && rules.maxLength !== undefined)
    parts.push(t(`form_cfg_msg_${unit}_between`, { min: rules.minLength, max: rules.maxLength }));
  else if (rules.minLength !== undefined) parts.push(t(`form_cfg_msg_${unit}_min`, { min: rules.minLength }));
  else if (rules.maxLength !== undefined) parts.push(t(`form_cfg_msg_${unit}_max`, { max: rules.maxLength }));
  if (rules.pattern !== undefined) parts.push(t('form_cfg_msg_pattern'));
  if (rules.step !== undefined) parts.push(t('form_cfg_msg_step', { step: rules.step }));
  if (rules.change === true) parts.push(t('form_cfg_msg_change'));
  return parts.join('. ');
}

export function placeholderOps(
  doc: Doc,
  task: string,
  key: string,
  locale: string,
  value: string,
): readonly Op[] {
  const existing = formOf(doc.effective(), task)[key]?.placeholder;
  return setFieldAttrOps(doc, task, key, 'placeholder', withLocalized(existing, locale, value));
}

/** The help text: the property's `description` (shown in every form that has the field). */
export function helpOps(doc: Doc, type: string, key: string, locale: string, value: string): readonly Op[] {
  const path = formatKeyPath(['types', type, 'properties', key, 'description']);
  const existing = doc.effective().types?.[type]?.properties[key]?.description;
  const next = withLocalized(existing, locale, value);
  return next === undefined ? clearOps(doc, path) : setOps(doc, path, next);
}

/** The form entry's `required`: true, or removed. */
export const requiredOps = (doc: Doc, task: string, key: string, on: boolean): readonly Op[] =>
  setFieldAttrOps(doc, task, key, 'required', on ? true : undefined);

/** The form entry's `readonly` (v3 `related.read_only`, A5): true shows the value and never writes it; off removes it (editable is the default). */
export const readonlyOps = (doc: Doc, task: string, key: string, on: boolean): readonly Op[] =>
  setFieldAttrOps(doc, task, key, 'readonly', on ? true : undefined);

/** The rules and the prefill as the constraint they are written as; `message` is the text for the current language. */
function constraintOps(
  doc: Doc,
  task: string,
  key: string,
  rules: Rules,
  calculate: string | undefined,
  locale: string,
  message: string,
): readonly Op[] {
  const entry = formOf(doc.effective(), task)[key] ?? {};
  const source = constraintOf(rules, calculate);
  if (source === entry.constraint) return [];
  const ops: Op[] = [...setFieldAttrOps(doc, task, key, 'constraint', source)];
  const text = source === undefined ? '' : message;
  ops.push(
    ...setFieldAttrOps(
      applied(doc, ops),
      task,
      key,
      'constraint_message',
      withLocalized(entry.constraint_message, locale, text),
    ),
  );
  return ops;
}

function applied(doc: Doc, ops: readonly Op[]): Doc {
  let cur = doc;
  for (const op of ops) cur = cur.apply(op).doc;
  return cur;
}

/**
 * A new prefill. "The value must change" follows it (its constraint names the prefill); without a prefill the rule goes.
 * A constraint the panel did not write is left as it is.
 */
export function prefillOps(
  doc: Doc,
  task: string,
  key: string,
  type: string,
  prefill: Prefill,
  locale: string,
  t: Translate,
): readonly Op[] {
  const file = doc.effective();
  const cfg = fieldConfigOf(file, task, type, key, locale);
  const next = calculateOf(prefill, key, cfg.property?.type);
  if (next === cfg.calculate) return [];
  const ops: Op[] = [...setFieldAttrOps(doc, task, key, 'calculate', next)];
  if (cfg.constraint.foreign) return ops;
  const clean = mergeRules(cfg.constraint.rules, next === undefined ? { change: undefined } : {});
  return [
    ...ops,
    ...constraintOps(
      applied(doc, ops),
      task,
      key,
      clean,
      next,
      locale,
      ruleMessage(clean, t, cfg.property?.type),
    ),
  ];
}

/** A change of the rules (length, count, pattern, step, "must change"); the other rules stay. Refused for a constraint the panel did not write. */
export function rulesOps(
  doc: Doc,
  task: string,
  key: string,
  type: string,
  patch: RulesPatch,
  locale: string,
  t: Translate,
): readonly Op[] {
  const cfg = fieldConfigOf(doc.effective(), task, type, key, locale);
  if (cfg.constraint.foreign) return [];
  const rules = mergeRules(cfg.constraint.rules, patch);
  // A pattern outside the `matches` subset and a step that is not above 0 with at most 9 decimal places are never written.
  if (rules.pattern !== undefined && patternProblem(rules.pattern) !== undefined) return [];
  if (rules.step !== undefined && !isValidStep(rules.step)) return [];
  return constraintOps(
    doc,
    task,
    key,
    rules,
    cfg.calculate,
    locale,
    ruleMessage(rules, t, cfg.property?.type),
  );
}
