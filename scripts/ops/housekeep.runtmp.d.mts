export const RUN_TMP_IDLE_MS: number;
export function procCwdsDefault(): string[];
export function procOpenPathsDefault(): string[];
export function runTmpCandidates(
  o: { tmp: string; repo: string; now: number; procCwds: () => string[] },
  isProtected: (dir: string, repo: string) => boolean,
  procOpenPaths?: () => string[],
): { kind: string; path: string; reason: string }[];
export function pwCacheOldFiles(dir: string, cutoff: number): { p: string; kb: number }[];
export function pwCacheCandidates(o: { tmp: string; now: number }): {
  kind: string;
  path: string;
  cutoff: number;
  kb: number;
  reason: string;
}[];
export function prunePwCache(c: { path: string; cutoff: number }): number;
