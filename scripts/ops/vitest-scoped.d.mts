export function scopedTmp(prefix?: string): { dir: string; env: NodeJS.ProcessEnv; remove: () => void };
export function maxWorkersCap(x: { load: number; nproc: number }): number | null;
export function withWorkerCap(
  args: string[],
  x: { load: number; nproc: number },
  say?: (m: string) => void,
): string[];
export function repeatsNote(args: string[]): string | null;
