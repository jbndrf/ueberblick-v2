/**
 * What the CSV wizard maps onto, from the project file (pure): the creating task's form fields (v3's `targetFields`,
 * `workflows/[workflowId]/+page.svelte:467-485`), the geometry's coordinate columns (v3's `specialColumns`, `:487-494`),
 * the stage (v3's 'In Stufe importieren') and the other properties that can take one value for all rows ('Wert für
 * alle Zeilen', register row 88). The wizard reads the deployed file when the type is deployed (the import runs on it)
 * and the draft otherwise (A4).
 */
import { CREATE_TASK, isTable, localize, type TemplateFile } from '@ueberblick/core';

type TypeDef = NonNullable<TemplateFile['types']>[string];

export interface ImportField {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  /** The property type, for the value input of a constant and the mapping's `language`. */
  readonly kind: string;
  /** Localized text: the language the column fills (the mapping must name one). */
  readonly language?: string;
}

export interface ImportConstant {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export interface ImportSetup {
  /** The task the rows go through: the creating task of an Objektart, `$create` for a Tabelle (WP-433). */
  readonly task: string;
  /** A Tabelle's key: `$create` names the type its rows belong to. */
  readonly type?: string;
  readonly taskLabel: string;
  readonly fields: readonly ImportField[];
  /** The geometry field of the task; a point also has the longitude and latitude columns. */
  readonly geometry: { readonly field: string; readonly point: boolean; readonly required: boolean } | null;
  readonly stage: {
    readonly property: string;
    readonly label: string;
    readonly start: string;
    readonly options: readonly { readonly value: string; readonly label: string }[];
  } | null;
  readonly constants: readonly ImportConstant[];
}

/** Property types a CSV cell or one typed value can fill. A geometry comes from coordinates, files from the app. */
const CELL_KINDS: ReadonlySet<string> = new Set([
  'text',
  'localized_text',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'time',
  'select',
  'multiselect',
  'participant',
  'role',
  'reference',
]);
/** Kinds with one input for a constant ('Wert für alle Zeilen'). */
const CONSTANT_KINDS: ReadonlySet<string> = new Set([
  'text',
  'number',
  'integer',
  'boolean',
  'date',
  'select',
  'role',
]);

const optionsOf = (p: NonNullable<TypeDef['properties'][string]>, locale: string) =>
  Object.entries(p.options ?? {}).map(([value, label]) => ({
    value,
    label: localize(label, [locale]) || value,
  }));

/** The properties that take one value for all rows: a select offers its options, a role the roles of the project. */
function constantsOf(
  file: TemplateFile,
  type: TypeDef,
  locale: string,
  label: (key: string) => string,
  skip?: string,
): ImportConstant[] {
  const roles = Object.entries(file.roles ?? {}).map(([value, r]) => ({
    value,
    label: localize(r.label, [locale]) || value,
  }));
  return Object.entries(type.properties)
    .filter(([key, p]) => key !== skip && CONSTANT_KINDS.has(p.type))
    .map(([key, p]) => ({
      key,
      label: label(key),
      kind: p.type,
      options: p.type === 'select' ? optionsOf(p, locale) : p.type === 'role' ? roles : [],
    }));
}

/**
 * A Tabelle has no creating task (nor geometry nor stage): each row is one `$create` run, the admin's way to add a row
 * (v3's table page imported into `custom_table_rows`, `custom-tables/[tableId]/+page.svelte:166-200`). Its columns are
 * the type's properties, in order.
 */
function tableSetupOf(file: TemplateFile, type: TypeDef, typeKey: string, locale: string): ImportSetup {
  const label = (key: string): string => localize(type.properties[key]?.label, [locale]) || key;
  const fields: ImportField[] = [];
  for (const [key, p] of Object.entries(type.properties)) {
    if (!CELL_KINDS.has(p.type)) continue;
    fields.push({
      key,
      label: label(key),
      required: p.required === true,
      kind: p.type,
      ...(p.type === 'localized_text' ? { language: locale } : {}),
    });
  }
  const constants = constantsOf(file, type, locale, label);
  return {
    task: CREATE_TASK,
    type: typeKey,
    taskLabel: localize(type.label, [locale]) || typeKey,
    fields,
    geometry: null,
    stage: null,
    constants,
  };
}

/** `table`: the page is a Tabelle's (a type without geometry and process), whose rows are `$create` runs. */
export function importSetupOf(
  file: TemplateFile,
  typeKey: string,
  locale: string,
  options: { readonly table?: boolean } = {},
): ImportSetup | null {
  const type = file.types?.[typeKey];
  if (type === undefined) return null;
  if (options.table === true) return isTable(type) ? tableSetupOf(file, type, typeKey, locale) : null;
  const entry = Object.entries(file.tasks ?? {}).find(([, t]) => t.creates === typeKey);
  if (entry === undefined) return null;
  const [task, def] = entry;
  const form = def.form ?? {};
  const label = (key: string): string => localize(type.properties[key]?.label, [locale]) || key;

  const fields: ImportField[] = [];
  for (const [key, f] of Object.entries(form)) {
    const p = type.properties[key];
    if (p === undefined || !CELL_KINDS.has(p.type)) continue;
    fields.push({
      key,
      label: label(key),
      required: f.required === true || p.required === true,
      kind: p.type,
      ...(p.type === 'localized_text' ? { language: locale } : {}),
    });
  }

  const geoKey = type.geometry;
  const geoProp = geoKey === undefined ? undefined : type.properties[geoKey];
  const geometry =
    geoKey !== undefined && geoProp !== undefined && geoKey in form
      ? {
          field: geoKey,
          point: geoProp.geometry_type === 'point',
          required: form[geoKey]?.required === true || geoProp.required === true,
        }
      : null;

  const stageKey = type.process?.property;
  const stageProp = stageKey === undefined ? undefined : type.properties[stageKey];
  const stage =
    stageKey !== undefined && stageProp !== undefined && type.process !== undefined
      ? {
          property: stageKey,
          label: label(stageKey),
          start: type.process.start,
          options: optionsOf(stageProp, locale),
        }
      : null;

  const constants = constantsOf(file, type, locale, label, stageKey);

  return { task, taskLabel: localize(def.label, [locale]) || task, fields, geometry, stage, constants };
}
