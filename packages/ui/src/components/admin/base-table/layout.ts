import { ACTIONS_COLUMN, SELECT_COLUMN } from './types';
import type { CellKind, TableColumn } from './types';

export const SELECT_COL_WIDTH = 48;
export const ACTIONS_COL_WIDTH = 64;
/** With row editing the actions cell holds two 44 px buttons (check and x). */
export const ROW_EDIT_ACTIONS_COL_WIDTH = 120;
const DEFAULT_MIN_WIDTH: Record<CellKind, number> = {
  text: 200,
  number: 120,
  date: 140,
  boolean: 100,
  array: 220,
  dropdown: 180,
  custom: 200,
};

export function columnWidth(id: string, columns: readonly TableColumn[], rowEdit = false): number {
  if (id === SELECT_COLUMN) return SELECT_COL_WIDTH;
  if (id === ACTIONS_COLUMN) return rowEdit ? ROW_EDIT_ACTIONS_COL_WIDTH : ACTIONS_COL_WIDTH;
  const col = columns.find((c) => c.key === id);
  return col?.minWidth ?? DEFAULT_MIN_WIDTH[col?.kind ?? 'text'];
}

export function columnStyle(id: string, columns: readonly TableColumn[], rowEdit = false): string {
  const w = columnWidth(id, columns, rowEdit);
  return `min-width: ${w}px; width: ${w}px;`;
}

/** The select and actions columns stick to the left and right edge while the table scrolls sideways. */
export function pinClass(id: string, layer: 'head' | 'body'): string {
  const z = layer === 'head' ? 'z-30' : 'z-10';
  if (id === SELECT_COLUMN) return `sticky left-0 ${z} shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]`;
  if (id === ACTIONS_COLUMN) return `sticky right-0 ${z} shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.1)]`;
  return '';
}

export function paddingClass(id: string): string {
  if (id === SELECT_COLUMN) return 'pr-2 pl-6';
  if (id === ACTIONS_COLUMN) return 'pr-6 pl-2';
  return 'px-6';
}
