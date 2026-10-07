export const MIN_FREE_BYTES: number;
export function fsModuleCacheOn(
  root: string,
  env?: Record<string, string | undefined>,
  freeBytes?: (path: string) => number,
): boolean;
export function lockHash(dir: string): string | null;
