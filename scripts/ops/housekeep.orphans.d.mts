export type Proc = { pid: number; ppid: number; cmdline: string; cwd?: string | undefined };
export type OrphanCandidate = { kind: 'orphan'; pid: number; reason: string };
export function orphanWorkerCandidates(
  procs: Proc[],
  opts?: { exists?: (path: string) => boolean },
): OrphanCandidate[];
export function readProcsDefault(proc?: string): Proc[];
export function orphanLine(c: { kind: string; pid?: number; reason: string }): string | undefined;
export function orphanServerCandidates(
  procs: Proc[],
  opts?: { exists?: (path: string) => boolean },
): OrphanCandidate[];
export function isAlive(
  pid: number,
  opts?: { proc?: string; kill?: (pid: number, signal: number) => void },
): boolean;
export function terminate(
  pid: number,
  kill?: (pid: number, signal: string) => void,
  graceMs?: number,
  alive?: (pid: number) => boolean,
  startOf?: (pid: number) => string | undefined,
): ReturnType<typeof setTimeout>;
export function orphanCandidates(
  procs: Proc[],
  opts?: { exists?: (path: string) => boolean },
): OrphanCandidate[];
export function startTime(pid: number, proc?: string): string | undefined;
