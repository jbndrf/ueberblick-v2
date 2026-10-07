/**
 * Pure builders of WP-200 ops for the field pane (v3 `FieldDefinitionEditor` and the options of
 * `FieldConfigPanel`): rename, required, type, options, delete. No DOM; the pane, tests and assistants (H4)
 * share them (R1). Options are always written as the whole `options` record: the order of the record is the
 * order of the options, and one overlay entry per path keeps later edits from being refused.
 */
import {
  PROPERTY_TYPES,
  formatKeyPath,
  localizeExact,
  type KeyPath,
  type LocalizedString,
  type Property,
  type TemplateFile,
} from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { removeOp, setLabelOp, setRequiredOp, slugKey } from '../../lenses/data-model/ops';
import { labelOf } from '../../shell/location';
import { dropPropertyPermsOps } from './perms';

export { setLabelOp, setRequiredOp };

const pathOf = (type: string, property: string): KeyPath =>
  formatKeyPath(['types', type, 'properties', property]);
const propertyOf = (file: TemplateFile, type: string, property: string): Property | undefined =>
  file.types?.[type]?.properties[property];

/** One option of a select or multiselect property, label in the builder's language. */
export interface OptionRow {
  readonly key: string;
  readonly label: string;
  /** The explanation text shown under the option (v3 "Antwort, Erklärungstext"; `option_hints`), in the builder's language. */
  readonly hint: string;
}

const hintText = (hint: LocalizedString | undefined, locale: string): string =>
  hint === undefined ? '' : localizeExact(hint, locale);

export function optionRows(property: Property, locale: string): OptionRow[] {
  return Object.entries(property.options ?? {}).map(([key, label]) => ({
    key,
    label: labelOf(label as LocalizedString, locale, key),
    hint: hintText(property.option_hints?.[key] as LocalizedString | undefined, locale),
  }));
}

function optionsOp(type: string, property: string, options: Record<string, LocalizedString>): Op {
  return { kind: 'set', path: `${pathOf(type, property)}.options` as KeyPath, value: options };
}

const optionsOf = (file: TemplateFile, type: string, property: string): Record<string, LocalizedString> =>
  ({ ...(propertyOf(file, type, property)?.options ?? {}) }) as Record<string, LocalizedString>;

const withLabel = (current: LocalizedString | undefined, locale: string, text: string): LocalizedString =>
  typeof current === 'object' ? { ...current, [locale]: text } : { [locale]: text };

/** The key a new option gets: from the label (A-005), never one that exists. */
export const optionKeyFor = (file: TemplateFile, type: string, property: string, text: string): string =>
  slugKey(text, new Set(Object.keys(optionsOf(file, type, property))));

/** Adds an option; its key comes from the label (A-005) and never collides with an existing one. */
export function addOptionOp(
  file: TemplateFile,
  type: string,
  property: string,
  text: string,
  locale: string,
): Op {
  const options = optionsOf(file, type, property);
  options[optionKeyFor(file, type, property, text)] = { [locale]: text };
  return optionsOp(type, property, options);
}

/** Renames the label of an option in `locale`. The key stays, so a rename never needs a value mapping. */
export function renameOptionOp(
  file: TemplateFile,
  type: string,
  property: string,
  key: string,
  text: string,
  locale: string,
): Op {
  const options = optionsOf(file, type, property);
  options[key] = withLabel(options[key], locale, text);
  return optionsOp(type, property, options);
}

/** Moves an option up (-1) or down (+1); undefined at either end. */
export function moveOptionOp(
  file: TemplateFile,
  type: string,
  property: string,
  key: string,
  delta: -1 | 1,
): Op | undefined {
  const entries = Object.entries(optionsOf(file, type, property));
  const from = entries.findIndex(([k]) => k === key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= entries.length) return undefined;
  const [moved] = entries.splice(from, 1);
  if (moved === undefined) return undefined;
  entries.splice(to, 0, moved);
  return optionsOp(type, property, Object.fromEntries(entries));
}

/** The `option_hints` record as a whole: one overlay entry per path keeps later edits from being refused. */
function hintsOp(
  file: TemplateFile,
  type: string,
  property: string,
  hints: Record<string, LocalizedString>,
): Op {
  const path = `${pathOf(type, property)}.option_hints` as KeyPath;
  return propertyOf(file, type, property)?.option_hints === undefined
    ? { kind: 'add', path, value: hints }
    : { kind: 'set', path, value: hints };
}

/**
 * The explanation text of an option in `locale` (v3 "Antwort, Erklärungstext"); empty text removes the language,
 * and an option with no language left has no hint. Undefined when nothing changes.
 */
export function setOptionHintOp(
  file: TemplateFile,
  type: string,
  property: string,
  key: string,
  text: string,
  locale: string,
): Op | undefined {
  const hints = { ...(propertyOf(file, type, property)?.option_hints ?? {}) } as Record<
    string,
    LocalizedString
  >;
  const now = hints[key];
  const kept: [string, string][] = Object.entries(
    typeof now === 'object' ? now : now === undefined ? {} : { [locale]: now },
  ).filter(([language]) => language !== locale);
  const next = text.trim();
  const languages = Object.fromEntries(next === '' ? kept : [...kept, [locale, next]]);
  const rest = Object.fromEntries(Object.entries(hints).filter(([k]) => k !== key));
  if (Object.keys(languages).length === 0) {
    if (now === undefined) return undefined;
    return hintsOp(file, type, property, rest);
  }
  return hintsOp(file, type, property, { ...hints, [key]: languages });
}

/**
 * Removes an option from the draft, with its explanation text (an `option_hints` key that is no option is a schema
 * error). Values on features are asked about when the draft goes live (deploy overview).
 */
export function removeOptionOps(file: TemplateFile, type: string, property: string, key: string): Op[] {
  const rest = Object.entries(optionsOf(file, type, property)).filter(([k]) => k !== key);
  const ops: Op[] = [];
  // The hint goes first: with the option gone and its hint still there the file is refused.
  const hints = propertyOf(file, type, property)?.option_hints as Record<string, LocalizedString> | undefined;
  if (hints !== undefined && key in hints)
    ops.push(
      hintsOp(file, type, property, Object.fromEntries(Object.entries(hints).filter(([k]) => k !== key))),
    );
  ops.push(optionsOp(type, property, Object.fromEntries(rest)));
  return ops;
}

const TYPE_ATTRIBUTES = [
  'options',
  'option_hints',
  'to',
  'accept',
  'max_files',
  'min',
  'max',
  'geometry_type',
] as const;
const KEPT = ['label', 'description', 'required', 'index', 'personal'] as const;

/**
 * The op that changes the type of a property. Attributes the new type does not allow go, the ones it
 * requires are seeded (an empty `options`; `to` the first of `typeKeys`), and a `default` of the old type is
 * dropped. The whole property is written at once, because no single-attribute step stays valid on the way.
 * Undefined when the type is the same, or a reference has no feature type to point at.
 */
export function changeTypeOp(
  file: TemplateFile,
  type: string,
  property: string,
  next: Property['type'],
  typeKeys: readonly string[],
): Op | undefined {
  const old = propertyOf(file, type, property);
  if (old === undefined || old.type === next) return undefined;
  const entry = PROPERTY_TYPES.get(next);
  const value: Record<string, unknown> = { type: next };
  for (const k of KEPT) if (old[k] !== undefined) value[k] = old[k];
  for (const k of TYPE_ATTRIBUTES) if (entry.options.includes(k) && old[k] !== undefined) value[k] = old[k];
  if (entry.requires.includes('options') && value['options'] === undefined) value['options'] = {};
  if (entry.requires.includes('to') && value['to'] === undefined) {
    const to = typeKeys[0];
    if (to === undefined) return undefined;
    value['to'] = to;
  }
  return { kind: 'set', path: pathOf(type, property), value };
}

/** The task forms that use a property: what a delete takes it out of (v3 delete-impact dialog). */
export interface Usages {
  readonly tasks: readonly string[];
}

export function usagesOf(file: TemplateFile, type: string, property: string): Usages {
  const tasks = Object.entries(file.tasks ?? {})
    .filter(([, t]) => {
      const on = Array.isArray(t.on) ? t.on : [t.on];
      return (on.includes(type) || t.creates === type) && t.form !== undefined && property in t.form;
    })
    .map(([key]) => key);
  return { tasks };
}

/** Deleting entirely: the property, its entries in the task forms and its entries in the permission maps. */
export function deletePropertyOps(doc: Doc, type: string, property: string): Op[] {
  const file = doc.effective();
  return [
    removeOp(doc, pathOf(type, property)),
    ...usagesOf(file, type, property).tasks.map((t) =>
      removeOp(doc, formatKeyPath(['tasks', t, 'form', property])),
    ),
    ...dropPropertyPermsOps(file, type, property),
  ];
}
