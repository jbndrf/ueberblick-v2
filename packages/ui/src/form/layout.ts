// How the fields of one form page are laid out in lines (v3 `groupFieldsByLayout` and `getColumnClass`,
// form-renderer/types.ts:273-345). The column and row come from the form entry (A-049: each form has its own layout; the
// property's `display` is the Daten view's); the form keeps the order of the task's `form`.
import type { PropertyDisplayColumn } from '@ueberblick/core/registry';

/** v3 `getColumnClass`: half-width cells share a line and shrink below their content (`min-w-0`), also on a phone. */
export const COLUMN_CLASS: Readonly<Record<PropertyDisplayColumn, string>> = {
  left: 'w-[calc(50%-0.5rem)] min-w-0',
  right: 'w-[calc(50%-0.5rem)] min-w-0 ml-auto',
  full: 'w-full min-w-0',
};

interface Placed {
  readonly column?: PropertyDisplayColumn | undefined;
  readonly row?: number | undefined;
}

/** Neighbours with the same `row` share a line; a field without a row is a line of its own (v3 `fallbackRow`). */
export function formLines<T extends Placed>(cells: readonly T[]): T[][] {
  const lines: T[][] = [];
  let last: number | undefined;
  for (const cell of cells) {
    const line = lines[lines.length - 1];
    if (line !== undefined && cell.row !== undefined && cell.row === last) line.push(cell);
    else lines.push([cell]);
    last = cell.row;
  }
  return lines;
}
