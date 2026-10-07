import { PROPERTY_TYPES, type FormAppearance, type PropertyTypeKey } from '@ueberblick/core/registry';
import {
  FormModelError,
  type BuildFormInput,
  type PageInfo,
  type FormField,
  type FormModel,
  type InputKind,
} from './contract';

/** Property type to input. Total over the registry: `model.spec.ts` fails when a type has no input. */
export const INPUT_KIND_BY_TYPE: Readonly<Record<PropertyTypeKey, InputKind>> = {
  text: 'text',
  localized_text: 'localized_text',
  number: 'number',
  integer: 'number',
  boolean: 'checkbox',
  date: 'date',
  datetime: 'datetime',
  time: 'time',
  select: 'select',
  multiselect: 'multiselect',
  participant: 'choice',
  role: 'choice',
  reference: 'choice',
  geometry: 'tool',
  file: 'tool',
};

/** The appearance token that draws a text input as a textarea (ODK `multiline`; v3's long text). */
export const MULTILINE_TOKEN: FormAppearance = 'multiline';

/** The appearance token that draws a text input as `type=email` (v3's email field type). */
export const EMAIL_TOKEN: FormAppearance = 'email';

/** Joins a task's form with the feature type's properties. Throws `FormModelError` for a form field
 * whose property is missing or whose type has no input; it never renders a blank. */
export function buildFormModel({ form, properties, placed, bound }: BuildFormInput): FormModel {
  const fields: FormField[] = [];
  for (const [key, entry] of Object.entries(form)) {
    const dot = key.indexOf('.');
    const owner = dot < 0 ? undefined : bound?.[key.slice(0, dot)];
    const prop = dot < 0 ? properties[key] : owner?.properties[key.slice(dot + 1)];
    if (!prop) {
      throw new FormModelError('unknown_property', key, `form field "${key}" has no property`);
    }
    if (prop.type === 'geometry' && placed?.[key] !== undefined) continue; // set on the map, not a row (v3)
    if (!PROPERTY_TYPES.has(prop.type)) {
      throw new FormModelError(
        'unknown_property_type',
        key,
        `property type "${String(prop.type)}" has no input`,
      );
    }
    const base: InputKind = INPUT_KIND_BY_TYPE[prop.type];
    const label = entry.label ?? prop.label ?? key;
    fields.push({
      key,
      id: `ub-field-${key}`,
      type: prop.type,
      input: entry.tool ? 'tool' : base,
      label,
      ...(owner !== undefined && { origin: owner.label }),
      ...(prop.description !== undefined && { description: prop.description }),
      ...(entry.placeholder !== undefined && { placeholder: entry.placeholder }),
      appearance: (entry.appearance ?? '').split(/\s+/).filter(Boolean),
      ...(entry.tool !== undefined && { tool: entry.tool }),
      ...(prop.options !== undefined && { options: prop.options }),
      ...(prop.option_hints !== undefined && { optionHints: prop.option_hints }),
      ...(prop.accept !== undefined && { accept: prop.accept }),
      ...(prop.max_files !== undefined && { maxFiles: prop.max_files }),
      ...(prop.min !== undefined && { min: prop.min }),
      ...(prop.max !== undefined && { max: prop.max }),
      integer: prop.type === 'integer',
      ...(base === 'choice' && prop.cardinality === 'many' && { multiple: true }),
      ...(prop.computed !== undefined && { computed: true as const }),
      ...(entry.column !== undefined && { column: entry.column }),
      ...(entry.row !== undefined && { row: entry.row }),
    });
  }
  // A field with `page` starts a page; its title and description are that page's (v3 `FormPage`).
  const pages: FormField[][] = [];
  const pageInfo: PageInfo[] = [];
  for (const f of fields) {
    const page = form[f.key]?.page;
    const current = pages[pages.length - 1];
    if (!current || page !== undefined) {
      pages.push([f]);
      pageInfo.push({
        ...(page?.label !== undefined && { title: page.label }),
        ...(page?.hint !== undefined && { description: page.hint }),
      });
    } else current.push(f);
  }
  if (pages.length === 0) return { fields, pages: [[]], pageInfo: [{}] };
  return { fields, pages, pageInfo };
}
