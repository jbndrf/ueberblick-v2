/**
 * What the Tabellen pages show, read from a project file (pure: no DOM, no I/O). A Tabelle is a type without geometry
 * and without a process (A-030, `sidebar-types.ts`). v3's table was `custom_tables` + `custom_table_columns`
 * (`custom-tables/columns.ts`): a name, a description, a "Hauptspalte", "Sichtbar für Rollen" and the columns; here the
 * columns are the type's properties in the admin's order and the Hauptspalte is the first of them (owner Q15).
 */
import { AUDIENCES, isTable, localize, type TemplateFile } from '@ueberblick/core';

type TypeDef = NonNullable<TemplateFile['types']>[string];

/** v3's four column types (`customTableEditType*`); a column of any other type came from the builder. */
export const COLUMN_TYPES = ['text', 'number', 'date', 'boolean'] as const;
export const isColumnType = (type: string): boolean => (COLUMN_TYPES as readonly string[]).includes(type);

/** Who sees the table's rows: every role, these roles, or nobody (no `see` yet, or one per property). */
export type TableAudience =
  | { readonly kind: 'all' }
  | { readonly kind: 'roles'; readonly roles: readonly string[] }
  | { readonly kind: 'none' };

export function audienceOf(def: TypeDef): TableAudience {
  const see: unknown = def.permissions?.see;
  if (see === AUDIENCES.keys[0]) return { kind: 'all' };
  if (Array.isArray(see) && see.length > 0) return { kind: 'roles', roles: see.map(String) };
  return { kind: 'none' };
}

export interface TableColumnDef {
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly required: boolean;
  readonly default?: string | number | boolean;
  /** Only in the draft: the grid shows it once the project is published. */
  readonly pending: boolean;
}

const labelOf = (v: Parameters<typeof localize>[0], locale: string, key: string): string =>
  localize(v, [locale]) || key;

/** The columns of one table in the order of its properties; `deployed` marks the ones the grid does not have yet. */
export function columnsOf(
  def: TypeDef,
  locale: string,
  deployed: TypeDef | undefined,
): readonly TableColumnDef[] {
  return Object.entries(def.properties).map(([key, p]) => ({
    key,
    label: labelOf(p.label, locale, key),
    type: p.type,
    required: p.required === true,
    ...(typeof p.default === 'string' || typeof p.default === 'number' || typeof p.default === 'boolean'
      ? { default: p.default }
      : {}),
    pending: deployed?.properties[key] === undefined,
  }));
}

export interface TableSummary {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** The label of the first column (Q15). */
  readonly mainLabel: string;
  readonly audience: TableAudience;
}

export function summariesOf(file: TemplateFile, locale: string): TableSummary[] {
  return Object.entries(file.types ?? {})
    .filter(([, def]) => isTable(def))
    .map(([key, def]) => {
      const first = Object.entries(def.properties)[0];
      return {
        key,
        label: labelOf(def.label, locale, key),
        description: def.description === undefined ? '' : localize(def.description, [locale]),
        mainLabel: first === undefined ? '' : labelOf(first[1].label, locale, first[0]),
        audience: audienceOf(def),
      };
    });
}
