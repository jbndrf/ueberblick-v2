export const WORKER_HEAP_MB: number;
export function availableMb(): number;
export function runWeight(env?: Record<string, string | undefined>): number;
export const RESERVE_MB: number;
export const YOUNG_MS: number;
export interface ShareInput {
  cores: number;
  availMb: number;
  runs: number;
  weight?: number;
  totalWeight?: number;
  youngWeight?: number;
  budgetMb?: number;
}
export function workerLimits(input: ShareInput): {
  workers: number;
  byCpu: number;
  byMem: number;
  memShareMb: number;
};
export function workerShare(input: ShareInput): number;
export function workerBudgetMb(rows: Array<Record<string, unknown>>, kind: string | null): number;
export function readTestRows(dir: string, kind?: string | null): Array<Record<string, unknown>>;
export function acquire(
  dir: string,
  weight?: number,
  kind?: string | null,
  now?: number,
): {
  workers: number;
  runs: number;
  weight: number;
  budgetMb: number;
  youngWeight: number;
  byCpu: number;
  byMem: number;
  memShareMb: number;
  release: () => void;
};
