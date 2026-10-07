export const RERUN_TRIGGERS: string[];
export function rerunTriggers(root: string): string[];
export function isRerunTrigger(root: string, file: string): boolean;
export function messageEntries(root: string): Record<string, string>;
export const PACKAGE_JSON_NARROW_KEYS: string[];
export interface ScanRule {
  name: string;
  matches: (file: string) => boolean;
  reads: RegExp;
  note?: string;
  label?: string;
  noReader?: 'all';
}
export const SCAN_RULES: ScanRule[];
export function isVitestSpec(file: string): boolean;
export const REPO_WALK: RegExp;
export function i18nScript(root: string, pkg: string): string;
