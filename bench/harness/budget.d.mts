export const DEVICES: readonly ['x4', 'server', 'dev-only', 'measured'];
export const THREADS: readonly ['main', 'worker', 'n/a'];
export type Device = (typeof DEVICES)[number];
export type Thread = (typeof THREADS)[number];
export interface BudgetSpec {
  readonly id: string;
  /** Upper limit: an (adjusted) value above it is a breach. */
  readonly limit: number;
  readonly unit: string;
  /** The docs/12 row this budget is. */
  readonly row?: string;
  /** How the limit derives from a docs/12 row (names the row). Required when `row` is absent. */
  readonly derivedFrom?: string;
  readonly device: Device;
  /** Where the measured work runs. Required for `x4`. */
  readonly thread?: Thread;
}
export type Budget = BudgetSpec;
export interface BudgetLine extends Budget {
  /** As measured on this machine. */
  readonly value: number;
  /** The value that is compared to the limit (value x DEVICE_FACTOR for time values of `x4` budgets). */
  readonly adjusted: number;
  readonly pass: boolean;
  /** Load per core when it was measured (`report`). */
  readonly load?: number;
}
export const DEVICE_FACTOR: 4;
export const DOC_BUDGETS: Readonly<Record<string, Budget & { readonly row: string }>>;
export function defineBudget(b: BudgetSpec): Budget;
export function docBudget(row: string, how?: { device?: Device; thread?: Thread; id?: string }): Budget;
export function factorOf(budget: Budget): number;
export function evaluate(budget: Budget, value: number): BudgetLine;
export function formatLine(line: BudgetLine, strict?: boolean): string;
export function report(budget: Budget, value: number): BudgetLine;
export const VERDICTS: readonly ['PASS', 'FAIL', 'UNRELIABLE'];
export type Verdict = (typeof VERDICTS)[number];
export const LOAD_LIMIT_PER_CORE: 0.5;
export function loadLimit(): number;
export function machineLoad(): number;
export const HARD_FACTOR: 2;
export function verdictOf(
  line: { pass: boolean; adjusted: number; limit: number; unit: string; load?: number },
  load?: number,
  strict?: boolean,
): Verdict;
export const strictMode: () => boolean;
/** PASS or UNRELIABLE returns the verdict, FAIL throws (see verdictOf). */
export function assertBudget(line: BudgetLine, strict?: boolean): Verdict;
