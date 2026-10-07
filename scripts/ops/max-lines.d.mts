export const MAX_LINES: number;
export const EXTENSIONS: string[];
export function isChecked(path: string): boolean;
export function countLines(text: string): number;
export function findViolations(paths: string[], read: (path: string) => string): string[];
