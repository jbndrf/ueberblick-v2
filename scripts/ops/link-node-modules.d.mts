export const EXCLUDE: Set<string>;
export const MARKER: string;
export function mainCheckout(cwd: string): string;
export function installMatchesLock(lock: unknown, hidden: unknown): string | null;
export function linkRefusal(
  worktree: string,
  main: string,
  opts?: { allowLockMismatch?: boolean },
): string | null;
export function ensureNodeModules(opts: {
  worktree: string;
  main?: string;
  dryRun?: boolean;
  replace?: boolean;
  allowLockMismatch?: boolean;
  npmCi?: (cwd: string, reason: string) => number;
}): { action: 'exists' | 'linked' | 'npm-ci' | 'dry-run'; reason: string; status: number };
export function defaultCi(cwd: string): number;
