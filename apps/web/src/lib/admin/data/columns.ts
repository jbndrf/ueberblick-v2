/**
 * The data page's columns and rows (v3 `workflows/[workflowId]/+page.svelte:359-494`) from the deployed type and the
 * list API's rows. Pure: no DOM, no I/O. A new property type is one entry in `PROPERTY_KINDS`; a new system column one
 * in `buildColumns`. Row keys follow the API: property keys and the `$` system keys (WP-313).
 */
import {
  LIFECYCLE_STATES,
  localize,
  shortId,
  SYSTEM_FIELD_SIGIL,
  type LifecycleState,
  type LocalizedString,
  type TemplateFile,
} from '@ueberblick/core';
import { actorName, type ActorLabels } from '../actor-names';
import type { ChoiceOption, TableColumn, TableRow } from '@ueberblick/ui/components/admin';

type TypeDef = NonNullable<TemplateFile['types']>[string];
type Property = TypeDef['properties'][string];

export type DataLocale = 'de' | 'en';

export interface DataLabels {
  readonly status: string;
  readonly stage: string;
  readonly createdBy: string;
  readonly location: string;
  readonly created: string;
  readonly yes: string;
  readonly no: string;
}

export interface ColumnsInput {
  readonly type: TypeDef;
  readonly locale: DataLocale;
  readonly labels: DataLabels;
  /** How the system and import actors read (the names come from the server). */
  readonly actors: ActorLabels;
  /** Actor id to name (participants, admins); an id that is not in it shows as it is. */
  readonly names: Readonly<Record<string, string>>;
  /**
   * The name of the feature a reference property points at: core `displayName` with the property's `display_property`
   * (Anzeigefeld, A-048). Absent, or answering undefined: the id shows as it is.
   */
  /** Role key to its labels: the cell of a `role` property shows the label. An unknown key shows as it is. */
  readonly roleLabels?: Readonly<Record<string, LocalizedString>>;
  readonly referenceName?: (key: string, id: string) => string | undefined;
}

const sys = (key: string): string => `${SYSTEM_FIELD_SIGIL}${key}`;
export const LIFECYCLE_KEY = sys('lifecycle');
export const CREATED_BY_KEY = sys('created_by');
export const CREATED_AT_KEY = sys('created_at');
export const LOCATION_KEY = sys('location');
export const ID_KEY = sys('id');
/** The filter value that means "no value" (the API's `__empty__`, BaseTable's `EMPTY_FILTER_KEY`). */
export const EMPTY_VALUE = '__empty__';

/**
 * How one property type shows in the table. `custom` columns get their cell from the page. `editable` marks the types
 * whose cell has an editor (Bearbeitungsmodus, Admin-Korrektur); participant, reference, localized text and file have
 * none yet, so they stay read-only (the engine accepts them: `$correct` checks every declared property).
 */
const PROPERTY_KINDS: Readonly<Record<string, Partial<TableColumn>>> = {
  text: { kind: 'text', editable: true },
  number: { kind: 'number', editable: true },
  integer: { kind: 'number', editable: true },
  boolean: { kind: 'boolean', editable: true },
  date: { kind: 'date', dateMode: 'date' as const, editable: true },
  datetime: { kind: 'date', dateMode: 'datetime' as const, editable: true },
  time: { kind: 'date', dateMode: 'time' as const, editable: true },
  select: { kind: 'array', singleSelect: true, editable: true },
  multiselect: { kind: 'array', sortable: false, editable: true },
  participant: { kind: 'text' },
  role: { kind: 'text' },
  reference: { kind: 'text' },
  localized_text: { kind: 'text', sortable: false, filterable: false },
  file: { kind: 'custom', sortable: false, filterable: false },
};

const optionsOf = (p: Property, locale: DataLocale): ChoiceOption[] =>
  Object.entries(p.options ?? {}).map(([value, label]) => ({
    value,
    label: localize(label, [locale]) || value,
  }));

const hasRoles = (labels: ColumnsInput['roleLabels']): boolean =>
  labels !== undefined && Object.keys(labels).length > 0;

const roleOptions = (labels: NonNullable<ColumnsInput['roleLabels']>, locale: DataLocale): ChoiceOption[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label: localize(label, [locale]) || value }));

export const lifecycleLabel = (state: string, locale: DataLocale): string => {
  const entry = LIFECYCLE_STATES.entries.find((e) => e.key === state);
  return entry ? entry.label[locale] : state;
};

/** One column per property in the type's order (the stage and a geometry are shown by their own columns, so not here). */
export function propertyColumns(
  type: TypeDef,
  locale: DataLocale,
  roleLabels?: ColumnsInput['roleLabels'],
): TableColumn[] {
  const stage = type.process?.property;
  const cols: TableColumn[] = [];
  for (const [key, p] of Object.entries(type.properties)) {
    // A `role` property is a select of the project's roles (v3 data page `[workflowId]/+page.svelte:277-285`); without
    // the roles there is nothing to choose from, so it stays a read-only text.
    const kind =
      p.type === 'role' && hasRoles(roleLabels)
        ? { kind: 'array' as const, singleSelect: p.cardinality !== 'many', editable: true }
        : PROPERTY_KINDS[p.type];
    if (kind === undefined || key === stage) continue; // geometry: shown as Standort
    cols.push({
      key,
      label: localize(p.label, [locale]) || key,
      ...kind,
      ...(p.type === 'select' || p.type === 'multiselect' ? { options: optionsOf(p, locale) } : {}),
      ...(p.type === 'role' && roleLabels !== undefined && hasRoles(roleLabels)
        ? { options: roleOptions(roleLabels, locale) }
        : {}),
    });
  }
  return cols;
}

/** The columns in v3's order: Status, Stufe, Erstellt von, Standort, the properties, Erstellt. */
export function buildColumns(input: ColumnsInput): TableColumn[] {
  const { type, locale, labels } = input;
  const stage = type.process?.property;
  const cols: TableColumn[] = [{ key: LIFECYCLE_KEY, label: labels.status, kind: 'custom', minWidth: 140 }];
  const stageProp = stage === undefined ? undefined : type.properties[stage];
  if (stage !== undefined && stageProp !== undefined) {
    cols.push({
      key: stage,
      label: labels.stage,
      ...PROPERTY_KINDS['select'],
      // The stage moves through tasks, so its rules and steps run: never edited in place (owner answer A1).
      editable: false,
      options: optionsOf(stageProp, locale),
    });
  }
  cols.push({ key: CREATED_BY_KEY, label: labels.createdBy, kind: 'text' });
  if (type.geometry !== undefined) {
    cols.push({
      key: LOCATION_KEY,
      label: labels.location,
      kind: 'custom',
      sortable: false,
      filterable: false,
    });
  }
  cols.push(...propertyColumns(type, locale, input.roleLabels));
  cols.push({
    key: CREATED_AT_KEY,
    label: labels.created,
    kind: 'date',
    dateMode: 'datetime',
    filterable: false,
  });
  return cols;
}

const fixed = (n: number): string => n.toFixed(4);

/** An API row as a table row (see the column kinds above). */
export function shapeRow(api: Readonly<Record<string, unknown>>, input: ColumnsInput): TableRow {
  const { type, locale, names, actors } = input;
  const row: TableRow = { ...api, id: api[ID_KEY] };
  const name = (v: unknown): unknown => (typeof v === 'string' ? actorName(names, v, actors) : v);
  row[CREATED_BY_KEY] = name(api[CREATED_BY_KEY]);
  for (const [key, p] of Object.entries(type.properties)) {
    const v = api[key];
    if (p.type === 'select') row[key] = v === undefined || v === null || v === '' ? [] : [String(v)];
    else if (p.type === 'participant') row[key] = Array.isArray(v) ? v.map(name).join(', ') : name(v);
    else if (p.type === 'role' && hasRoles(input.roleLabels))
      row[key] = Array.isArray(v)
        ? v.map(String)
        : v === undefined || v === null || v === ''
          ? []
          : [String(v)];
    else if (p.type === 'role') {
      const role = (r: unknown): unknown => {
        const label = typeof r === 'string' ? input.roleLabels?.[r] : undefined;
        return label === undefined ? r : localize(label, [locale]) || r;
      };
      row[key] = Array.isArray(v) ? v.map(role).join(', ') : role(v);
    } else if (p.type === 'reference') {
      const ref = (id: unknown): unknown =>
        typeof id === 'string' ? (input.referenceName?.(key, id) ?? shortId(id)) : id;
      row[key] = Array.isArray(v) ? v.map(ref).join(', ') : ref(v);
    } else if (p.type === 'localized_text')
      row[key] = v && typeof v === 'object' ? localize(v as never, [locale]) : '';
  }
  const lon = api['lon'];
  const lat = api['lat'];
  if (type.geometry !== undefined) {
    if (typeof lon === 'number' && typeof lat === 'number') {
      const shape = type.properties[type.geometry]?.geometry_type;
      row[LOCATION_KEY] = `${fixed(lat)}, ${fixed(lon)}${shape && shape !== 'point' ? ` (${shape})` : ''}`;
    } else row[LOCATION_KEY] = '';
  }
  return row;
}

/** The label a filter list shows for a raw value of a column (the API answers raw keys). */
export function filterLabelOf(input: ColumnsInput): (column: string, value: string) => string {
  const { type, locale, labels, names, actors } = input;
  return (column, value) => {
    if (column === LIFECYCLE_KEY) return lifecycleLabel(value as LifecycleState, locale);
    if (column === CREATED_BY_KEY) return actorName(names, value, actors);
    const p = type.properties[column];
    if (p === undefined) return value;
    if (p.type === 'boolean') return value === 'true' ? labels.yes : value === 'false' ? labels.no : value;
    if (p.type === 'participant') return actorName(names, value, actors);
    if (p.type === 'role') {
      const role = input.roleLabels?.[value];
      return role === undefined ? value : localize(role, [locale]) || value;
    }
    const option = p.options?.[value];
    return option === undefined ? value : localize(option, [locale]) || value;
  };
}
