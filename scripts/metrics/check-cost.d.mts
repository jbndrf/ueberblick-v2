export interface Counts {
  full: number;
  changed: number;
  fullMs: number;
  changedMs: number;
  initial: number;
  fix: number;
  afterPass: number;
  gateWaitMs: number;
}
export interface CheckCostReport {
  rows: (Counts & { wp: string })[];
  land: Counts;
  other: Counts;
  totals: {
    landed: number;
    fullChecks: number;
    changedRuns: number;
    fullPerLanded: number | null;
    fullMs: number;
    changedMs: number;
    gateWaitMs: number | null;
    fullTestRuns: number;
  };
}
export function wpOfBranch(branch: string | null | undefined): string | null;
export function parseEvents(texts: Map<string, string>): Map<string, { t: number; text: string }[]>;
export function checkCost(input: {
  steps: object[];
  tests: object[];
  events: Map<string, { t: number; text: string }[]>;
  since: Date;
  until?: Date;
}): CheckCostReport;
export function formatCheckCost(report: CheckCostReport): string;
