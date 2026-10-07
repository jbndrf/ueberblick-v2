/**
 * What the form editor shows, read from the effective file (pure): the task's form joined with the properties
 * of its feature type, laid out in pages and lines (`layout.ts`), and the library of properties that are not in
 * the form yet. The participant's form is built from the same pieces: `buildFormModel` and `formLines` of
 * `@ueberblick/ui` (R1); the editor adds what editing needs (a card for a field that has no property).
 */
import { stepProperties, type Property, type PropertyTypeKey, type TemplateFile } from '@ueberblick/core';
import { FormModelError, buildFormModel, type FormField } from '@ueberblick/ui';
import { labelOf } from '../../shell/location';
import { stagePropertyOf } from '../task/ops';
import { subjectTypeOf } from '../task/step-ops';
import { boundInput, boundOf, splitBindKey, type BoundTarget } from './bound';
import { layoutOf, type Layout, type Placed } from './layout';

export interface FieldView {
  readonly key: string;
  readonly label: string;
  /** Absent when the form names a property the type does not have (a problem the checker reports). */
  readonly type?: PropertyTypeKey;
  /** `required` of the form entry (true or an expression) or of the property. */
  readonly required: boolean;
  readonly computed: boolean;
  /** A field of a linked Objekt (`<bind>.<property>`, A-047): the Objektart's name; absent for the task's own field. */
  readonly origin?: string;
  /** The form entry shows the value and never writes it (`readonly: true`; A5 "schreibgeschützt"). */
  readonly readonly: boolean;
  /** The entry has a `relevant` (v3 "has conditional logic") or a `constraint` ("has validation rules"). */
  readonly conditional: boolean;
  readonly validated: boolean;
  /** The renderer's field for the live preview; absent when the form model cannot build it. */
  readonly field?: FormField;
}

export interface LibraryEntry {
  readonly key: string;
  readonly label: string;
  readonly type: PropertyTypeKey;
  /** In this form already: shown greyed (v3 `usedDefIds`). */
  readonly used: boolean;
  /** How many task forms of the type hold the property (v3 "n×"). */
  readonly usage: number;
  readonly computed: boolean;
}

export interface EditorModel {
  /** The feature type whose properties the form edits. */
  readonly type: string;
  readonly fields: ReadonlyMap<string, FieldView>;
  readonly layout: Layout;
}

type Form = NonNullable<NonNullable<TemplateFile['tasks']>[string]['form']>;

export function formOf(file: TemplateFile, task: string): Form {
  return file.tasks?.[task]?.form ?? {};
}

function fieldOf(
  form: Form,
  key: string,
  properties: Readonly<Record<string, Property>>,
  bound: ReturnType<typeof boundInput>,
): FormField | undefined {
  const entry = form[key];
  if (entry === undefined) return undefined;
  try {
    return buildFormModel({ form: { [key]: entry }, properties, bound }).fields[0];
  } catch (e) {
    if (e instanceof FormModelError) return undefined;
    throw e;
  }
}

const boundProperty = (file: TemplateFile, target: BoundTarget, property: string): Property | undefined =>
  file.types?.[target.type]?.properties[property];

export function editorModel(file: TemplateFile, task: string, fallback: string, locale: string): EditorModel {
  const type = subjectTypeOf(file, task, fallback);
  const properties = file.types?.[type]?.properties ?? {};
  const form = formOf(file, task);
  const targets = boundOf(file, task, fallback, locale);
  const bound = boundInput(file, targets);
  const fields = new Map<string, FieldView>();
  const placed: Placed[] = [];
  for (const [key, entry] of Object.entries(form)) {
    const link = splitBindKey(key);
    const target = link === undefined ? undefined : targets.find((x) => x.name === link.bind);
    const prop =
      link === undefined
        ? properties[key]
        : target === undefined
          ? undefined
          : boundProperty(file, target, link.property);
    const field = fieldOf(form, key, properties, bound);
    fields.set(key, {
      key,
      label: labelOf(entry.label ?? prop?.label, locale, key),
      ...(target === undefined ? {} : { origin: target.typeLabel }),
      readonly: entry.readonly === true || typeof entry.readonly === 'string',
      ...(prop === undefined ? {} : { type: prop.type }),
      required: entry.required === true || typeof entry.required === 'string' || prop?.required === true,
      computed: prop?.computed !== undefined,
      conditional: entry.relevant !== undefined,
      validated: entry.constraint !== undefined || prop?.min !== undefined || prop?.max !== undefined,
      ...(field === undefined ? {} : { field }),
    });
    placed.push({
      key,
      column: entry.column,
      row: entry.row,
      page: entry.page as Placed['page'],
    });
  }
  return { type, fields, layout: layoutOf(placed) };
}

/**
 * The properties of the type a form may take (v3 `LibraryFieldsPalette`: the workflow's field definitions):
 * not the stage (only `then.set` writes it), not a geometry (the Standort step takes it), and not one that a
 * quick edit or the Standort step of this task writes (one writer each, `stepCandidates`).
 */
export function libraryOf(
  file: TemplateFile,
  task: string,
  fallback: string,
  locale: string,
): LibraryEntry[] {
  const t = file.tasks?.[task];
  if (t === undefined) return [];
  const type = subjectTypeOf(file, task, fallback);
  const form = t.form ?? {};
  const stage = stagePropertyOf(file, task, fallback);
  const stepKeys = new Set(stepProperties(t));
  const tasks = Object.values(file.tasks ?? {});
  return Object.entries(file.types?.[type]?.properties ?? {})
    .filter(([key, p]) => key !== stage && p.type !== 'geometry' && !stepKeys.has(key))
    .map(([key, p]) => ({
      key,
      label: labelOf(p.label, locale, key),
      type: p.type,
      used: key in form,
      usage: tasks.filter((x) => x.form !== undefined && key in x.form).length,
      computed: p.computed !== undefined,
    }));
}
