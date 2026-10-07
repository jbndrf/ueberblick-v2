/**
 * The "Vorlage" section's edits on the project's draft (WP-448, engine-new: register a3 row 103). The template author
 * offers customisation points (`TemplateFile.inputs`); the project's overlay sets their values (`inputs.<key>`). Each
 * save is a builder Doc op (`set`, or `reset` when the value is the template's own default), so there is no second
 * write path (R1, R3). Headless, like `chat-doc.ts`.
 */
import { applyOps, type Doc, type Op } from '@ueberblick/builder';
import { localize, type TemplateFile } from '@ueberblick/core';
import type { TemplateInputView, TemplateView } from '../../../../../../lib/admin/settings/types';
import type { SettingsEdit } from './settings-doc';

/** The property types a template input can be edited as here (the rest show their value read-only). */
const EDITABLE: readonly string[] = [
  'text',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'time',
  'select',
  'multiselect',
  'localized_text',
];

interface InputLike {
  readonly type: string;
  readonly label?: unknown;
  readonly description?: unknown;
  readonly default?: unknown;
  readonly options?: Readonly<Record<string, unknown>>;
}

const loc = (v: unknown, locale: string, fallback: string): string =>
  localize(v as Parameters<typeof localize>[0], [locale]) || fallback;

/** What the section shows: the template, its version and one entry per declared input (value = the effective default). */
export function templateView(file: TemplateFile, locale: string): TemplateView {
  const inputs = Object.entries((file.inputs ?? {}) as Record<string, InputLike>).map(
    ([key, p]): TemplateInputView => ({
      key,
      type: p.type,
      editable: EDITABLE.includes(p.type),
      label: loc(p.label, locale, key),
      ...(p.description === undefined ? {} : { description: loc(p.description, locale, '') }),
      value: p.default ?? null,
      options: Object.entries(p.options ?? {}).map(([k, l]) => ({ key: k, label: loc(l, locale, k) })),
    }),
  );
  return {
    key: file.template.key,
    label: loc(file.template.label, locale, file.template.key),
    version: file.template.version,
    inputs,
  };
}

const refused = (detail: string): SettingsEdit => ({ ok: false, code: 'refused', detail });

function fits(p: InputLike, value: unknown): boolean {
  switch (p.type) {
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'select':
      return typeof value === 'string' && Object.hasOwn(p.options ?? {}, value);
    case 'multiselect':
      return (
        Array.isArray(value) && value.every((v) => typeof v === 'string' && Object.hasOwn(p.options ?? {}, v))
      );
    case 'localized_text':
      return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.values(value).every((v) => typeof v === 'string')
      );
    case 'text':
    case 'date':
    case 'datetime':
    case 'time':
      return typeof value === 'string';
    default:
      return false;
  }
}

/** Sets the given input values (key to value); a value equal to the template's own default drops the overlay entry. */
export function setTemplateInputs(doc: Doc, values: Readonly<Record<string, unknown>>): SettingsEdit {
  const declared = (doc.effective().inputs ?? {}) as Record<string, InputLike>;
  const own = (doc.template.inputs ?? {}) as Record<string, InputLike>;
  const ops: Op[] = [];
  for (const [key, value] of Object.entries(values)) {
    const p = declared[key];
    if (p === undefined) return refused(`inputs.${key}`);
    if (!EDITABLE.includes(p.type) || !fits(p, value)) return { ok: false, code: 'invalid', detail: key };
    const same = JSON.stringify(own[key]?.default) === JSON.stringify(value);
    ops.push(same ? { kind: 'reset', path: `inputs.${key}` } : { kind: 'set', path: `inputs.${key}`, value });
  }
  const r = applyOps(doc, ops);
  return 'refused' in r ? refused(r.refused.message) : { ok: true, doc: r.doc };
}
