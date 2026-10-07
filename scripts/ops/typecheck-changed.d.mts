export const PROJECTS: { name: string; tsconfig: string; script: string }[];
export function selectTypecheck(
  cwd: string,
  files: string[],
  deleted?: string[],
): { all: boolean; projects: string[]; line: string };
