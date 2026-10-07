/** The differential report: a machine-readable summary and a text form for people. Format: apps/migrate/README.md. */
import { DIFF_CAUSES, type DiffCause } from './registry';
import type { Difference } from './types';

export interface DiffReport {
  /** Runs that were checked. */
  readonly runs: number;
  /** Runs without any difference. */
  readonly agreed: number;
  /** Differences by cause; every registry cause is present (0 when none). */
  readonly byCause: Readonly<Record<DiffCause, number>>;
  /** Runs with at least one difference that no report item, note or missing counterpart explains. */
  readonly unexplained: number;
  readonly differences: readonly Difference[];
}

export function summarize(runCount: number, differences: readonly Difference[]): DiffReport {
  const byCause = Object.fromEntries(DIFF_CAUSES.keys.map((k) => [k, 0])) as Record<DiffCause, number>;
  for (const d of differences) byCause[d.cause]++;
  const differing = new Set(differences.map((d) => d.runId));
  return {
    runs: runCount,
    agreed: runCount - differing.size,
    byCause,
    unexplained: byCause.unexplained,
    differences,
  };
}

/** One block per difference, unexplained first, then a summary line. */
export function formatReport(report: DiffReport): string {
  const order = [...report.differences].sort(
    (a, b) => Number(b.cause === 'unexplained') - Number(a.cause === 'unexplained'),
  );
  const lines = order.map(
    (d) =>
      `[${d.cause}] ${d.runId}: ${d.kind}\n  v3: ${d.v3}\n  v4: ${d.v4}\n  why: ${d.reason}` +
      (d.items.length > 0 ? `\n  report items: ${d.items.join(', ')}` : ''),
  );
  const causes = DIFF_CAUSES.keys.map((k) => `${k} ${report.byCause[k]}`).join(', ');
  lines.push(
    `${report.runs} runs, ${report.agreed} agree, ${report.differences.length} differences (${causes})`,
  );
  return lines.join('\n');
}
