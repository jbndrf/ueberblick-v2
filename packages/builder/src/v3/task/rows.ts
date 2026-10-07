/**
 * The Bedingungen rows (v3 `SentryEditor.svelte`: field, operator, value, AND) over core's chips. A row is
 * one compare chip; what a row says is what `toChips` read, so the rows never change the meaning of a
 * condition (R5). v3 operators map as the register says: is_empty = `== null`, is_not_empty = `!= null`.
 * No DOM: the pane and its tests share this.
 */
import type { Chip, Json } from '@ueberblick/core';
import { literalText, parseLiteral, type CompareChip } from '../../shell/conditions';

/** The operator choices of a row, in v3's order; `empty` and `notEmpty` take no value. */
export const ROW_OPS = ['==', '!=', '<', '<=', '>', '>=', 'in', 'empty', 'notEmpty'] as const;
export type RowOp = (typeof ROW_OPS)[number];

/** The message key naming each operator choice. */
export const ROW_OP_MESSAGES = {
  '==': 'tp_op_eq',
  '!=': 'tp_op_ne',
  '<': 'tp_op_lt',
  '<=': 'tp_op_le',
  '>': 'tp_op_gt',
  '>=': 'tp_op_ge',
  in: 'tp_op_in',
  empty: 'tp_op_empty',
  notEmpty: 'tp_op_not_empty',
} as const satisfies Record<RowOp, string>;

/** The operator choice a compare chip shows as. */
export function rowOpOf(chip: CompareChip): RowOp {
  if (chip.right === null && chip.op === '==') return 'empty';
  if (chip.right === null && chip.op === '!=') return 'notEmpty';
  return chip.op as RowOp;
}

/**
 * The chip after the operator choice changed; the value stays unless the new operator takes none. A row
 * that was "ist leer" starts its value at `start` (a value of the property's type).
 */
export function withRowOp(chip: CompareChip, op: RowOp, start: Json = ''): CompareChip {
  if (op === 'empty') return { ...chip, op: '==', right: null };
  if (op === 'notEmpty') return { ...chip, op: '!=', right: null };
  const right = chip.right === null ? (start ?? '') : chip.right;
  return { ...chip, op, right: op === 'in' && !Array.isArray(right) ? [right] : right };
}

/** The value as typed: text as it is, numbers, true, false, null and lists in their own form. */
export function rowValueText(v: Json): string {
  return typeof v === 'string' ? v : literalText(v);
}

/**
 * Typed text as a value. A quoted text is that text; a number, `true`, `false`, `null` or a list reads as
 * itself; anything else is plain text (v3 always took the typed value as text).
 */
export function rowValueOf(text: string): Json {
  const t = text.trim();
  if (t === '') return '';
  const r = parseLiteral(t);
  return r.ok ? r.value : text;
}

/** The value `text` means for operator `op`: `in` always compares with a list. */
export function rowValueFor(op: RowOp, text: string): Json {
  const v = rowValueOf(text);
  return op === 'in' && !Array.isArray(v) ? [v] : v;
}

/** Whether a row compare takes a typed value. */
export const rowTakesValue = (op: RowOp): boolean => op !== 'empty' && op !== 'notEmpty';

export const isCompare = (c: Chip): c is CompareChip => c.kind === 'compare';
