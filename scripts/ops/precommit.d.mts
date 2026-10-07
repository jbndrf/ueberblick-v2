export function referenceViolation(files: string[]): string | null;
export function plan(files: string[]): { prettier: string[]; eslint: string[] };
export function conflictMarkerLine(text: string): number | null;
export function conflictViolation(files: string[], read: (file: string) => string | null): string | null;
export function userDocs(files: string[]): string[];
