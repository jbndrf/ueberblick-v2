export function parseExclude(text: string): string[];
export function keptScripts(
  scripts: Record<string, string>,
  excluded: readonly string[],
): Record<string, string>;
export function exportTree(
  out: string,
  ref?: string,
  root?: string,
): { excluded: string[]; dropped: string[] };
