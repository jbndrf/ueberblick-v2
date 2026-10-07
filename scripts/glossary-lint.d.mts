export function checkText(text: string, file: string): string[];
export function toWords(line: string): string;
export function scanRepo(roots?: string[]): {
  problems: string[];
  files: string[];
  reads: string[];
  bytes: number;
};
