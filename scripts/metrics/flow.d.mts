export interface WpEvent {
  at: Date;
  event: string;
}
export interface Wp {
  id: string;
  status: string;
  major: boolean;
  events: WpEvent[];
}
export interface WpFlow {
  id: string;
  major: boolean;
  mergedAt: Date;
  cycleMs: number | null;
  rounds: number;
  firstPass: boolean;
  blockedMs: number;
  escalated: boolean;
  reverts: number;
}
export function parseWp(text: string): Wp;
export function summarize(w: Wp): WpFlow | null;
export function eventLines(id: string, repo?: string): string[];
export function wpFlow(since: Date, until: Date, repo?: string): WpFlow[];
