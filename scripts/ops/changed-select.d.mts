export const ALWAYS_SPECS: string[];
export function changedFiles(cwd: string, base: string): { files: string[]; deleted: string[] };
export function specFiles(cwd: string): string[];
export function selectChanged(
  cwd: string,
  files: string[],
  deleted?: string[],
  opts?: { base?: string; head?: string },
): { all: boolean; related: string[]; lines: string[]; messagePackages: string[] };
