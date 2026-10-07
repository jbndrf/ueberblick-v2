/** The columns of one feature type, derived from its config once per request (R1: `propertySql` reads properties). */
import {
  KeySchema,
  propertySql,
  SEARCHABLE_PROPERTY_TYPES,
  SYSTEM_FIELD_SIGIL,
  SYSTEM_FIELDS,
  type TemplateFile,
} from '@ueberblick/core';
import { COLUMN_KIND_OF_TYPE, ID_COLUMN, type ColumnKind } from './registry';

export interface Column {
  readonly key: string;
  readonly kind: ColumnKind;
  /** SQL that reads the value over `features f`. */
  readonly sql: string;
  readonly system: boolean;
  /** Ids and timestamps: case folding changes no order, so they sort binary (an index on them stays usable). */
  readonly binary: boolean;
}

export interface TypeColumns {
  readonly columns: ReadonlyMap<string, Column>;
  /** SQL of the text properties the search looks into, plus "Erstellt von". */
  readonly searchable: readonly string[];
  /** Property keys that are not columns (geometry): left out of rows, the anchor carries lon and lat. */
  readonly hidden: ReadonlySet<string>;
}

type TypeDef = NonNullable<TemplateFile['types']>[string];

export function columnsOf(type: TypeDef): TypeColumns {
  const columns = new Map<string, Column>();
  const searchable: string[] = [];
  const hidden = new Set<string>();
  for (const [key, p] of Object.entries(type.properties)) {
    const kind = COLUMN_KIND_OF_TYPE[p.type];
    if (kind === undefined) {
      hidden.add(key);
      continue;
    }
    if (!KeySchema.safeParse(key).success) continue; // interpolated into SQL
    const sql = propertySql('f', key);
    columns.set(key, { key, kind, sql, system: false, binary: false });
    if (SEARCHABLE_PROPERTY_TYPES.has(p.type)) searchable.push(sql);
  }
  columns.set(ID_COLUMN, { key: ID_COLUMN, kind: 'text', sql: 'f.id', system: true, binary: true });
  for (const s of SYSTEM_FIELDS.entries) {
    const key = `${SYSTEM_FIELD_SIGIL}${s.key}`;
    columns.set(key, {
      key,
      kind: 'text',
      sql: `f.${s.column}`,
      system: true,
      binary: s.type === 'timestamp',
    });
  }
  searchable.push('f.created_by');
  return { columns, searchable, hidden };
}
