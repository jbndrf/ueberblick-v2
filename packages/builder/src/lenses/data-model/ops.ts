/**
 * Pure builders of WP-200 ops for the data model lens. No DOM: the lens, tests and assistants (H4)
 * share them (R1). Every edit is an `Op`; nothing here writes anywhere else.
 */
import {
  parseKeyPath,
  type KeyPath,
  type LocalizedString,
  type Property,
  type RelationCardinality,
  type TemplateFile,
} from '@ueberblick/core';
import type { Doc, Op } from '../../doc';

const KEY_START = /^[a-z]/;
const FOLD: Readonly<Record<string, string>> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** A config key (`^[a-z][a-z0-9_]*$`) made from free text, unique among `taken` (`name`, `name_2`, ...). */
export function slugKey(text: string, taken: ReadonlySet<string>): string {
  let s = text
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => FOLD[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (s === '') s = 'neu';
  if (!KEY_START.test(s)) s = `k${s}`;
  if (!taken.has(s)) return s;
  for (let n = 2; ; n++) if (!taken.has(`${s}_${n}`)) return `${s}_${n}`;
}

const label = (locale: string, text: string): LocalizedString => ({ [locale]: text });

/** What the "add property" form collects; the type decides which of the rest is needed (registry `requires`). */
export interface PropertyDraft {
  readonly label: string;
  readonly locale: string;
  readonly type: Property['type'];
  /** select / multiselect: option labels, comma separated. */
  readonly options?: string;
  /** reference: the feature type key. */
  readonly to?: string;
  /** geometry: kind from the registry. */
  readonly geometryType?: string;
  readonly required?: boolean;
}

export function optionsOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(',')) {
    const t = raw.trim();
    if (t !== '') out[slugKey(t, new Set(Object.keys(out)))] = t;
  }
  return out;
}

export function addPropertyOp(typeKey: string, key: string, d: PropertyDraft): Op {
  const value: Record<string, unknown> = { type: d.type, label: label(d.locale, d.label) };
  if (d.options !== undefined && d.options.trim() !== '') value['options'] = optionsOf(d.options);
  if (d.to !== undefined && d.to !== '') value['to'] = d.to;
  if (d.geometryType !== undefined && d.geometryType !== '') value['geometry_type'] = d.geometryType;
  if (d.required === true) value['required'] = true;
  return { kind: 'add', path: `types.${typeKey}.properties.${key}`, value };
}

export function addTypeOp(key: string, text: string, locale: string): Op {
  return { kind: 'add', path: `types.${key}`, value: { label: label(locale, text), properties: {} } };
}

export interface RelationDraft {
  readonly to: string;
  readonly derive?: string;
  readonly cardinality?: RelationCardinality;
}

/** A type without any relation has no `relations` map to add into: the first one creates the map. */
export function addRelationOp(file: TemplateFile, typeKey: string, key: string, d: RelationDraft): Op {
  const value: Record<string, unknown> = { to: d.to };
  if (d.derive !== undefined && d.derive.trim() !== '') value['derive'] = d.derive.trim();
  if (d.cardinality !== undefined) value['cardinality'] = d.cardinality;
  if (file.types?.[typeKey]?.relations === undefined) {
    return { kind: 'add', path: `types.${typeKey}.relations`, value: { [key]: value } };
  }
  return { kind: 'add', path: `types.${typeKey}.relations.${key}`, value };
}

const valueAt = (file: TemplateFile, path: KeyPath): unknown =>
  (parseKeyPath(path) ?? []).reduce<unknown>(
    (node, seg) =>
      node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[seg] : undefined,
    file,
  );

/** `Doc.apply` writes a `set` as an `add` when the template has no value there, so lenses just `set`. */
const writeOp = (path: KeyPath, value: unknown): Op => ({ kind: 'set', path, value });

/** Sets the label in `locale`, keeping the other languages. */
export function setLabelOp(file: TemplateFile, path: KeyPath, locale: string, text: string): Op {
  const current = valueAt(file, `${path}.label`) as LocalizedString | undefined;
  const next = typeof current === 'object' ? { ...current, [locale]: text } : { [locale]: text };
  return writeOp(`${path}.label`, next);
}

export function setRequiredOp(file: TemplateFile, path: KeyPath, required: boolean): Op {
  return writeOp(`${path}.required`, required);
}

/** An added entity is dropped (`reset`); one of the template is hidden (`hide`). */
export function removeOp(doc: Doc, path: KeyPath): Op {
  return doc.provenance(path) === 'added' ? { kind: 'reset', path } : { kind: 'hide', path };
}
