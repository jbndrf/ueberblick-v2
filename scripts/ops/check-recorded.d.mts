export interface TestRecord {
  at?: string | undefined;
  sha?: string | undefined;
  gitTree?: string | null | undefined;
  tree?: string | undefined;
  kind?: string | undefined;
  crashed?: boolean | undefined;
  exitCode?: number | undefined;
  wallMs?: number | undefined;
  passed?: number | undefined;
  skipped?: number | undefined;
}
export interface StepRecord {
  at?: string | undefined;
  gitTree?: string | null | undefined;
  tree?: string | undefined;
  suite?: string | undefined;
  parent?: string | null | undefined;
  exitCode?: number | undefined;
  wallMs?: number | undefined;
  ownPackages?: boolean | undefined;
}
export function kindOf(args: string[], env: Record<string, string | undefined>): string;
export function judge(
  records: TestRecord[],
  ref: { tree: string; sha: string },
): { ok: true; record: TestRecord } | { ok: false; reason: string };
export function judgeCheck(
  tests: TestRecord[],
  steps: StepRecord[],
  ref: { tree: string; sha: string },
): { ok: true; record: TestRecord } | { ok: false; reason: string };
export function judgeChanged(
  tests: TestRecord[],
  steps: StepRecord[],
  ref: { tree: string; sha: string },
): { ok: true; record: TestRecord | StepRecord; via: 'changed' | 'check' } | { ok: false; reason: string };
