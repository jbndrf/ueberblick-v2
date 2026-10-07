export function mergeBase(cwd: string, ref: string): string;
export type Selection = { all: boolean; reason: string; seeds: number };
export function recordedSelection(
  plan?: { argv?: string[]; lines?: string[]; selection?: Partial<Selection> } | null,
): Selection;
export function vitestArgs(
  args: string[],
  cwd: string,
  changes?: { files: string[]; deleted: string[] } | null,
): Promise<{ argv: string[]; lines: string[]; selection?: Selection }>;
