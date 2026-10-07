import type { TableColumn } from '../types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const TIME = /^(\d{1,2}):(\d{2})/;

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '' || value === '-';
}

export function inputType(column: TableColumn): 'text' | 'number' | 'date' | 'datetime-local' | 'time' {
  if (column.kind === 'number') return 'number';
  if (column.kind !== 'date') return 'text';
  if (column.dateMode === 'time') return 'time';
  return column.dateMode === 'datetime' ? 'datetime-local' : 'date';
}

/** What a cell shows when it is not being edited. */
export function displayValue(value: unknown, column: TableColumn, locale: string): string {
  if (isBlank(value)) return '-';
  const str = String(value);
  if (column.kind !== 'date') return str;
  if (column.dateMode === 'time') {
    const match = TIME.exec(str);
    return match ? `${(match[1] ?? '').padStart(2, '0')}:${match[2]}` : str;
  }
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) return str;
  return column.dateMode === 'datetime'
    ? date.toLocaleString(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** The value an input element expects. */
export function toEditingValue(value: unknown, column: TableColumn): string {
  if (isBlank(value)) return '';
  const str = String(value);
  if (column.kind !== 'date') return str;
  if (column.dateMode === 'time') {
    const match = TIME.exec(str);
    return match ? `${(match[1] ?? '').padStart(2, '0')}:${match[2]}` : '';
  }
  if (column.dateMode === 'datetime') return ISO_DATETIME.test(str) ? str.slice(0, 16) : '';
  return ISO_DATE.test(str) ? str : str.slice(0, 10);
}
