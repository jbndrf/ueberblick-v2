import type { Budget } from '../../harness/budget.mjs';

export interface RunRow {
  readonly scenario?: string;
  readonly label: string;
  readonly budget: Budget;
  readonly value: number;
  readonly reportOnly?: boolean;
  /** `max`: the worst single run instead of the median. */
  readonly aggregate?: 'median' | 'max';
  /** Reported next to the enforced rows, never judged (B-008). */
  readonly info?: boolean;
}
export interface Aggregated {
  readonly scenario: string;
  readonly label: string;
  readonly budget: Budget;
  readonly value: number;
  readonly reportOnly: boolean;
  readonly info: boolean;
  readonly aggregate: 'median' | 'max';
}
export function median(xs: readonly number[]): number;
export function aggregateRuns(id: string, perRun: readonly (readonly RunRow[])[]): Aggregated[];
