export type Candidate = {
  kind:
    | 'tmp'
    | 'pwcache'
    | 'cache'
    | 'copy'
    | 'vitest-cache'
    | 'worktree'
    | 'prune'
    | 'branch'
    | 'log'
    | 'orphan';
  pid?: number;
  path?: string;
  branch?: string | null;
  unlock?: boolean;
  reason: string;
  kb: number;
  base?: string;
  files?: string[];
  cutoff?: number;
  report?: string;
  parts?: string[];
};
export type Options = {
  repo: string;
  tmp?: string;
  main?: string;
  now?: number;
  cacheSoftMb?: number;
  cwd?: string;
  logDir?: string;
  pidAlive?: (pid: number) => boolean;
  procCwds?: () => string[];
  procs?: () => { pid: number; ppid: number; cmdline: string; cwd?: string | undefined }[];
  orphanExists?: (path: string) => boolean;
  kill?: (pid: number, signal: string) => void;
  killGraceMs?: number;
};
export const DISK_CLEAN_PCT: number;
export const DISK_STOP_PCT: number;
export function isLanded(repo: string, branch: string | null): boolean;
export function isProtected(path: string, repo: string): boolean;
export function plan(opts: Options): {
  candidates: Candidate[];
  skipped: { kind: string; path: string; reason: string }[];
};
export function remove(c: Candidate, opts: Options): string;
export function applyAll(candidates: Candidate[], repo: string, out: (line: string) => void): number;
export function ramAdvice(m: {
  availMb: number;
  swapUsedMb: number;
  swapTotalMb: number;
  memTotalMb: number;
  pressure?: { some: number };
}): string;
export function memory(
  text?: string,
  pressure?: { some: number },
): {
  availMb: number;
  memTotalMb: number;
  memAvailMb: number;
  swapTotalMb: number;
  swapUsedMb: number;
  pressure: { some: number };
};
export function main(argv: string[], out?: (line: string) => void): number;
export function newestMtime(root: string, limit?: number): { newest: number; truncated: boolean };
export const REMOVE_HINT: Record<string, (c: Candidate) => string>;
