export function parseBarrel(text: string): Map<string, { source: string; from: string }> | null;
export function barrelDiff(
  before: string,
  after: string,
): {
  barrel: boolean;
  added: { name: string; from: string }[];
  removed: string[];
  changed: string[];
};
export function additiveBarrel(
  cwd: string,
  file: string,
  opts?: { base?: string; head?: string; note?: (text: string) => void },
): { added: number; targets: string[] } | null;
