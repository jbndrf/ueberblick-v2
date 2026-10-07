export function latestBenchRows(dir: string): { date: string; rows: Record<string, unknown>[] } | null;
export function rowCells(rows: readonly Record<string, unknown>[]): string[][];
