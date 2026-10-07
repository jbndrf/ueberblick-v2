/**
 * The admin's list of columns while the manager is open (v3 `custom-field-manager-generic.svelte`): how a typed form
 * becomes a column, and the list after an add, an edit, a delete or a move. The route saves the whole list (`columns`
 * call), so every change is a new array and the array order is the column order (the first is the Hauptspalte, Q15).
 * A new column has a temporary key (`new:<n>`); the server makes the property key from its name (`table-ops.ts`).
 */
import { definitionOf, type ColumnForm } from '../columns/form';
import type { ColumnSpec } from './types';

export const isNewKey = (key: string): boolean => key.startsWith('new:');

/** The list after adding a column (at the end). */
export function withAdded(list: readonly ColumnSpec[], form: ColumnForm): ColumnSpec[] {
  let n = 1;
  while (list.some((c) => c.key === `new:${n}`)) n += 1;
  return [...list, definitionOf(`new:${n}`, form)];
}
