export const STATUSES: readonly string[];
export const STEPS: readonly number[];
export interface StepSummary {
  verified: number;
  built: number;
  missing: number;
  owner: number;
  dropped: number;
  all: number;
  pctDone: number;
  pctVerified: number;
}
export interface ParitySummary {
  steps: Record<1 | 2 | 3 | 4 | 5, StepSummary>;
  total: StepSummary;
}
export function checkEntries(entries: Record<string, unknown>[]): string[];
export function summarize(entries: Record<string, unknown>[]): ParitySummary;
export function missingLines(entries: Record<string, unknown>[]): string[];
export function render(summary: ParitySummary): string;
export function summaryLine(summary: ParitySummary): string;
export function loadEntries(file?: string): Record<string, unknown>[];
