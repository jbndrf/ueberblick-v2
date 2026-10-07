import type { Budget } from '../../harness/budget.mjs';

export const SLOW_PARAM: string;
export interface Measurement {
  readonly scenario: string;
  readonly label: string;
  readonly budget: Budget;
  readonly value: number;
  /** Shown against the limit but never fails (renderer init, B-007). */
  readonly reportOnly?: boolean;
  /** Reported next to the enforced rows, never judged. Only valid as the worst run (`aggregate: 'max'`) of a row that also has an enforced median (B-008). */
  readonly info?: boolean;
  readonly aggregate?: 'median' | 'max';
}
export interface Row {
  readonly scenario: string;
  readonly label: string;
  readonly id: string;
  readonly value: number;
  readonly limit: number;
  readonly unit: string;
  readonly pass: boolean;
  readonly reportOnly: boolean;
}
export function judgeAll(measurements: readonly Measurement[]): { rows: Row[]; info: Measurement[] };
export function judge(measurements: readonly Measurement[]): Row[];
export function renderTable(rows: readonly Row[]): string;
