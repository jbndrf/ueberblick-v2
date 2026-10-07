type Row = {
  at?: string;
  kind?: string;
  branch?: string;
  wallMs?: number;
  selection?: { all?: boolean; reason?: string; seeds?: number };
};
export type Reason = { reason: string; blanket: boolean; count: number; minutes: number; branches: string[] };
export type Summary = {
  scoped: number;
  blanket: number;
  blanketShare: number;
  blanketMinutes: number;
  scopedMinutes: number;
  byReason: Reason[];
};
export const UNRECORDED: string;
export function summarize(rows: Row[], opts?: { hours?: number; now?: number }): Summary;
export function summaryLine(s: Summary, hours: number): string;
export function render(s: Summary, hours: number): string;
