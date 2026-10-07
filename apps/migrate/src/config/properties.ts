/** v3 fields and custom table columns become v4 properties. */
import type { Property, PropertyTypeKey } from '@ueberblick/core';
import { KeySpace } from './keys';
import type { PropInfo } from './ctx';
import { isRec, unref } from './read';
import type { Rec, SrcColumnRecord, SrcProp } from './model';
import { personalReason } from './personal';
import type { Report } from './report';

export interface PropDeps {
  readonly report: Report;
  readonly knownRole: (v3: string) => string | undefined;
  /** The feature type key of a custom table, if the table exists. */
  readonly tableType: (v3Table: string) => string | undefined;
  /** The feature type key of a workflow, if it exists. */
  readonly workflowType: (v3Workflow: string) => string | undefined;
  /** Role keys and names, for a selector over roles. */
  readonly roleOptions: () => Record<string, string>;
}

const rec = (x: unknown): Rec => (isRec(x) ? x : {});
const str = (x: unknown): string | undefined => (typeof x === 'string' && x !== '' ? x : undefined);
const num = (x: unknown): number | undefined => (typeof x === 'number' ? x : undefined);
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

interface OptionSet {
  readonly map: Map<string, string>;
  readonly def: Record<string, string>;
}

/** Options from `string | { label }` entries: v3 stores the label, v4 stores a key. */
function optionSet(entries: unknown[], into?: OptionSet): OptionSet {
  const keys = new KeySpace();
  const out = into ?? { map: new Map<string, string>(), def: {} };
  for (const k of Object.keys(out.def)) keys.take(k, 'v');
  for (const e of entries) {
    const label = typeof e === 'string' ? e : str(rec(e)['label']);
    if (label === undefined || out.map.has(label)) continue;
    const key = keys.take(label, 'v');
    out.map.set(label, key);
    out.map.set(key, key);
    out.def[key] = label;
  }
  return out;
}

/** The audience of a v3 role list: `undefined` when unrestricted, else the roles that exist (possibly none). */
const AUDIENCE = (deps: PropDeps, x: unknown): string[] | undefined =>
  list(x).length === 0
    ? undefined
    : list(x)
        .map((r) => deps.knownRole(unref(r)))
        .filter((r): r is string => r !== undefined);

/** One v3 field to a property plus what forms and conditions need to know about it. */
export function buildProperty(p: SrcProp, keys: KeySpace, deps: PropDeps): PropInfo {
  const { report } = deps;
  const r = p.record;
  const opts = rec(r['field_options']);
  const rules = rec(r['validation_rules']);
  const v3Type = str(r['field_type']) ?? 'short_text';
  const key = keys.take(p.key);
  const isMany = v3Type === 'instance_reference' && opts['multiplicity'] === 'many';
  const target = isMany ? `relations.${key}` : `properties.${key}`;
  /** The report id of a column; a column the export omitted is noted on the field itself. */
  const at = (col: string): string => (col in r ? `${p.id}.${col}` : p.id);
  const approx = (col: string, reason: string): void => report.approximated(at(col), reason, target);
  const drop = (col: string, reason: string): void => report.dropped(at(col), reason);

  let type: PropertyTypeKey = 'text';
  let optionSet_: OptionSet | undefined;
  let to: string | undefined;
  const def: Property = { type };
  const constraints: string[] = [];
  let message: string | undefined;
  let appearance: string | undefined;

  switch (v3Type) {
    case 'short_text':
      break;
    case 'long_text':
      appearance = 'multiline';
      break;
    case 'number':
      type = 'number';
      break;
    case 'email':
      constraints.push(`value.contains('@')`);
      message = 'Bitte eine E-Mail-Adresse eingeben';
      approx('field_type', 'v4 has no e-mail property type; it is a text property with a form constraint');
      break;
    case 'date': {
      const mode = str(opts['date_mode']) ?? 'date';
      type = mode === 'date' ? 'date' : mode === 'datetime' ? 'datetime' : 'text';
      if (mode === 'time') approx('field_type', 'v4 has no time-of-day property type; stored as text');
      break;
    }
    case 'file':
      type = 'file';
      break;
    case 'dropdown':
    case 'multiple_choice':
      type = v3Type === 'dropdown' ? 'select' : 'multiselect';
      optionSet_ = optionSet(list(opts['options']));
      break;
    case 'smart_dropdown': {
      type = opts['allow_multiple'] === true ? 'multiselect' : 'select';
      optionSet_ = optionSet(list(opts['mappings']).flatMap((m) => list(rec(m)['options'])));
      approx(
        'field_type',
        'the options no longer depend on another field; all options of all mappings are offered',
      );
      break;
    }
    case 'custom_table_selector': {
      const source = str(opts['source_type']) ?? 'custom_table';
      if (source === 'participants') type = 'participant';
      else if (source === 'roles') {
        type = 'select';
        optionSet_ = optionSet(Object.values(deps.roleOptions()));
      } else {
        to = deps.tableType(unref(opts['custom_table_id']));
        if (to) type = 'reference';
        else approx('field_type', 'the custom table does not exist; kept as text');
      }
      if (opts['allow_multiple'] === true)
        approx('field_options', 'v4 references pick one feature; "allow multiple" is dropped');
      if (str(opts['display_field']) || str(opts['value_field']))
        approx('field_options', 'display and value columns are chosen by the renderer in v4');
      break;
    }
    case 'instance_reference': {
      to = deps.workflowType(unref(opts['target_workflow_id']));
      if (to) type = 'reference';
      else approx('field_type', 'the target workflow does not exist; kept as text');
      break;
    }
    default:
      approx('field_type', `unknown v3 field type "${v3Type}"; kept as text`);
  }
  def.type = type;
  if (type === 'select' || type === 'multiselect') def.options = optionSet_?.def ?? {};
  if (type === 'reference' && to) def.to = to;
  const label = str(r['field_label']);
  if (label) def.label = label;
  const personal = personalReason({ type: v3Type, key: p.key, label: label ?? '', options: opts });
  if (personal !== undefined) def.personal = { subject: 'actor' };

  // validation rules
  const min = num(rules['min']);
  const max = num(rules['max']);
  if (type === 'number') {
    if (min !== undefined) def.min = min;
    if (max !== undefined) def.max = max;
  } else if (min !== undefined || max !== undefined)
    drop('validation_rules', 'min and max apply to numbers only');
  if (rules['step'] !== undefined) drop('validation_rules', 'v4 numbers have no step');
  const minLength = num(rules['minLength']);
  const maxLength = num(rules['maxLength']);
  if (minLength !== undefined || maxLength !== undefined) {
    if (type === 'text') {
      if (minLength !== undefined) constraints.push(`size(value) >= ${minLength}`);
      if (maxLength !== undefined) constraints.push(`size(value) <= ${maxLength}`);
      message = message ?? 'Die Länge des Textes passt nicht';
      approx('validation_rules', 'length limits are form constraints in v4, not property limits');
    } else drop('validation_rules', 'length limits apply to text properties only');
  }
  if (str(rules['pattern']))
    drop('validation_rules', 'the rule language has no regular expressions; the pattern is dropped');
  if (rules['minSelections'] !== undefined || rules['maxSelections'] !== undefined) {
    drop('validation_rules', 'v4 has no selection count limits');
  }
  if (v3Type === 'file') {
    const accept = list(opts['allowed_file_types']).filter((t): t is string => typeof t === 'string');
    if (accept.length > 0) def.accept = accept;
    const maxFiles = num(opts['max_files']);
    if (maxFiles !== undefined && maxFiles >= 1) def.max_files = Math.floor(maxFiles);
  }

  // roles
  const view = AUDIENCE(deps, r['view_roles']);
  let write: string[] | undefined = AUDIENCE(deps, r['write_roles']);
  const writeMode = str(r['write_mode']) ?? 'observation';
  if (writeMode === 'computed') {
    write = [];
    drop(
      'compute_expression',
      'computed values are produced by the task that computes them in v4; the formula is not carried over',
    );
    approx(
      'write_mode',
      'only the tasks that computed it in v3 (their audience) or rules (system runs) write this property',
    );
  }

  report.columns(p.id, r, {
    field_label: ['mapped', undefined, `${target}.label`],
    field_type: ['mapped', undefined, `${target}.type`],
    field_options: ['mapped', undefined, target],
    view_roles: ['mapped', undefined, 'permissions.see'],
    write_roles: ['mapped', undefined, 'permissions.write'],
    write_mode: ['mapped', undefined, 'every v4 property is an append-only observation'],
    validation_rules: ['mapped', undefined, target],
    output_type: ['dropped', 'the v4 property type decides the value type'],
    compute_expression: ['dropped', 'computed values are produced by a rule in v4'],
    display_config: ['dropped', 'layout belongs to the renderer; tabs come from the data views'],
    project_to: ['dropped', 'system projection column, provisioned by the platform in v4'],
    is_system: ['dropped', 'system property, provisioned by the platform in v4'],
  });
  report.mapped(p.id, target);

  return {
    v3Key: p.key,
    key,
    type,
    options: optionSet_?.map ?? new Map<string, string>(),
    ...(to ? { to } : {}),
    writeMode,
    constraints,
    ...(message ? { constraintMessage: message } : {}),
    ...(appearance ? { appearance } : {}),
    view,
    write,
    def,
    ...(personal !== undefined ? { personalReason: personal } : {}),
    ...(isMany && type === 'reference' && to ? { relation: { type: to, property: '' } } : {}),
  };
}

const COLUMN_TYPES: Record<string, PropertyTypeKey> = {
  text: 'text',
  number: 'number',
  date: 'date',
  boolean: 'boolean',
};

/** A custom table column as a property of the table's feature type. */
export function buildColumn(c: SrcColumnRecord, keys: KeySpace, report: Report): PropInfo {
  const name = str(c.record['column_name']) ?? 'column';
  const key = keys.take(name);
  const type = COLUMN_TYPES[str(c.record['column_type']) ?? 'text'] ?? 'text';
  const label = str(c.record['label']) ?? str(c.record['display_name']) ?? name;
  const def: Property = { type, label };
  report.mapped(c.id, `properties.${key}`);
  return {
    v3Key: name,
    key,
    type,
    options: new Map(),
    writeMode: 'observation',
    constraints: [],
    view: undefined,
    write: undefined,
    def,
  };
}
