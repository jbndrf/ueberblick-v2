export interface Catalogue {
  exact: Set<string>;
  patterns: RegExp[];
  values: string[];
}
export const IGNORE_MARK: string;
export function patternOf(value: string): RegExp;
export function loadCatalogue(locale: string, dirs?: string[]): Catalogue;
export function isKnown(text: string, cat: Catalogue): boolean;
export function checkDoc(text: string, file: string, cat: Catalogue): string[];
export function scanDocs(root?: string, dirs?: string[], only?: string[]): { problems: string[]; files: string[] };
export function ellipsisSpelling(text: string, cat: Catalogue): string | null;
