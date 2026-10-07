/** What crosses between the Tabellen pages and their route (`tables/+server.ts`): plain data, no builder types. */
import { defineRegistry, type KeyOf } from '@ueberblick/core';

/** Why a table edit was not made; the route turns each into the page's refusal text (R6, one registry). */
export const TABLE_ERRORS = defineRegistry([
  { key: 'name_empty', description: 'The table has no name.' },
  {
    key: 'bad_key',
    description: 'The table name is not a key (a letter first, then lowercase letters, digits, _).',
  },
  { key: 'key_exists', description: 'A type with this key exists already.' },
  { key: 'unknown_table', description: 'The project file has no table with this key.' },
  { key: 'column_empty', description: 'A column has no name.' },
  { key: 'column_exists', description: 'Two columns share a name.' },
  { key: 'problem', description: 'The edit would leave a compile problem in the project file.' },
  { key: 'refused', description: 'The document model refused the edit (a lock, a schema problem).' },
  { key: 'no_version', description: 'Nothing is deployed yet, so there is no draft to edit.' },
  { key: 'conflict', description: 'The draft was saved by someone else in the meantime.' },
] as const);
export type TableErrorCode = KeyOf<typeof TABLE_ERRORS>;

/** The calls of the route (`tables/+server.ts`). */
export const TABLE_ACTIONS = defineRegistry([
  { key: 'create', description: 'A new table (a type without geometry and process) with its first column.' },
  { key: 'update', description: 'Name, description, Hauptspalte or roles of a table.' },
  { key: 'delete', description: 'Removes a table from the draft.' },
  { key: 'columns', description: 'The whole list of columns of a table: add, rename, remove, reorder.' },
] as const);
export type TableAction = KeyOf<typeof TABLE_ACTIONS>;

/** A column as the manager edits it (the shape of the participants' `CustomColumn`, so one dialog serves both). */
export interface ColumnSpec {
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly required?: boolean;
  readonly default?: string | number | boolean;
}

export type TableCall =
  | {
      readonly action: Extract<TableAction, 'create'>;
      readonly name: string;
      /** v3's "Tabellenname"; left out, it is made from the name. */
      readonly key?: string;
      readonly description?: string;
      readonly mainColumn: string;
      readonly roles?: readonly string[];
    }
  | {
      readonly action: Extract<TableAction, 'update'>;
      readonly table: string;
      readonly name?: string;
      readonly description?: string;
      readonly mainColumn?: string;
      /** An empty list means every role (v3's "Alle"). */
      readonly roles?: readonly string[];
    }
  | { readonly action: Extract<TableAction, 'delete'>; readonly table: string }
  | {
      readonly action: Extract<TableAction, 'columns'>;
      readonly table: string;
      readonly columns: readonly ColumnSpec[];
    };
