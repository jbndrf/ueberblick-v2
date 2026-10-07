/**
 * The form of one column and the list edits both column managers share (the participants' own columns and the
 * Tabellen columns, v3 `custom-field-manager-generic.svelte`): how a typed form becomes a column, and the list after an
 * edit or a delete. The key of a new column and the order differ per manager and stay with it.
 */

/** One column as both managers store it. */
export interface ColumnDef {
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly default?: string | number | boolean;
  readonly required?: boolean;
}

/** The form's fields are edited in place (a bound input per field), so none is readonly. */
export interface ColumnForm {
  label: string;
  type: string;
  required: boolean;
  /** As typed; turned into the column's type when saved. */
  defaultText: string;
}

export const emptyForm = (type: string): ColumnForm => ({
  label: '',
  type,
  required: false,
  defaultText: '',
});

export const formOf = (c: ColumnDef): ColumnForm => ({
  label: c.label,
  type: c.type,
  required: c.required === true,
  defaultText: c.default === undefined ? '' : String(c.default),
});

const TRUE = /^(true|ja|yes|1)$/i;

/** The default as the column's type holds it; an empty or unusable text means no default. */
export function defaultOf(type: string, text: string): string | number | boolean | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  if (type === 'number') return Number.isFinite(Number(t)) ? Number(t) : undefined;
  if (type === 'boolean') return TRUE.test(t);
  return t;
}

/** The column the form describes, stored under `key`. */
export function definitionOf(key: string, form: ColumnForm): ColumnDef {
  const standard = defaultOf(form.type, form.defaultText);
  return {
    key,
    label: form.label.trim(),
    type: form.type,
    ...(standard !== undefined ? { default: standard } : {}),
    ...(form.required ? { required: true } : {}),
  };
}

/** The list after editing the column with `key` (its key never changes: values are stored under it). */
export const withEdited = (list: readonly ColumnDef[], key: string, form: ColumnForm): ColumnDef[] =>
  list.map((c) => (c.key === key ? definitionOf(key, form) : c));

export const without = (list: readonly ColumnDef[], key: string): ColumnDef[] =>
  list.filter((c) => c.key !== key);

/** v3 refused a name that exists already. */
export const labelTaken = (list: readonly ColumnDef[], label: string, except?: string): boolean =>
  list.some((c) => c.key !== except && c.label.trim().toLowerCase() === label.trim().toLowerCase());
