export declare const CLASSES: readonly ['new', 'fix', 'tooling', 'test', 'docs'];
export type WpClass = (typeof CLASSES)[number];
export interface WpRow {
  id: string;
  title: string;
  lane: string;
  date: string | null;
  class: WpClass;
  rule: string;
}
type Fm = Record<string, string | string[]>;
export function parseWp(text: string): { fm: Fm; goal: string };
export function laneOf(id: string): string;
export function classify(
  wp: { id: string; fm: Fm; goal?: string },
  doneIds?: Set<string>,
): { class: WpClass; rule: string };
export function landDates(log: string): Record<string, string>;
export function classifyAll(files: { id: string; text: string }[], dates?: Record<string, string>): WpRow[];
export function countBy(rows: WpRow[]): Record<WpClass, number>;
export function reportRow(rows: WpRow[], today: string, days?: number): [string, string, string];
export function dayReport(rows: WpRow[], today: string, days?: number): string;
export function loadRows(workDir?: string): WpRow[];
