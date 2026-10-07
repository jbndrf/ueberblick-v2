export function depsInstall(opts: {
  worktree: string;
  main?: string;
  npmCi?: (cwd: string) => number;
  say?: (line: string) => void;
}): { action: string; reason: string; status: number };
