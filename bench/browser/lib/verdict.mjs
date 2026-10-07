// Judging measurements against budgets and printing the table. Pure; the runner and the spec use it.
import { evaluate } from '../../harness/budget.mjs';

/** URL parameter that slows a scenario on purpose (self-test: the run must fail). */
export const SLOW_PARAM = 'slow';

/**
 * Budgets whose row may be report-only: renderer init (MapLibre module evaluation, GL context, first render)
 * is measured and shown, judged on a real GPU (B-007). No other row can opt out of its limit.
 */
export const REPORT_ONLY_BUDGETS = Object.freeze(['map-renderer-init']);

/**
 * @param {{scenario: string, label: string, budget: {id: string, limit: number, unit: string}, value: number, reportOnly?: boolean}[]} ms
 * @returns {{scenario: string, label: string, id: string, value: number, limit: number, unit: string, pass: boolean}[]}
 */
export function judge(ms) {
  return ms.map((m) => {
    const line = evaluate(m.budget, m.value);
    // A value that is not a finite number means the scenario did not measure: that is a failure.
    // A report-only row (for example renderer init, B-007) is shown against its reference limit but never fails.
    const reportOnly = m.reportOnly === true;
    if (reportOnly && !REPORT_ONLY_BUDGETS.includes(m.budget.id))
      throw new Error(`row "${m.label}": budget ${m.budget.id} may not be report-only`);
    return {
      scenario: m.scenario,
      label: m.label,
      ...line,
      reportOnly,
      pass: Number.isFinite(m.value) && (reportOnly || line.pass),
    };
  });
}

/**
 * Judges every enforced row and separates the info rows (B-008). An info row is only legal as the worst single
 * run (`aggregate: 'max'`) of a row whose scenario also has an enforced median row with the same budget id;
 * anything else would be a way to hide a budget, so it throws.
 * @param {Parameters<typeof judge>[0]} ms
 */
export function judgeAll(ms) {
  const info = ms.filter((m) => m.info === true);
  const enforced = ms.filter((m) => m.info !== true);
  for (const m of info) {
    if (m.aggregate !== 'max')
      throw new Error(`info row "${m.label}" must aggregate as max, not ${m.aggregate ?? 'median'}`);
    const twin = enforced.some(
      (e) => e.scenario === m.scenario && e.budget.id === m.budget.id && e.aggregate !== 'max',
    );
    if (!twin)
      throw new Error(
        `info row "${m.label}" has no enforced median row for budget ${m.budget.id} in ${m.scenario}`,
      );
  }
  return { rows: judge(enforced), info };
}

const pad = (s, n) => String(s).padEnd(n);

/** @param {ReturnType<typeof judge>} rows */
export function renderTable(rows) {
  const w = [
    Math.max(8, ...rows.map((r) => r.scenario.length)),
    Math.max(5, ...rows.map((r) => r.label.length)),
    Math.max(6, ...rows.map((r) => r.id.length)),
  ];
  const head = `${pad('scenario', w[0])}  ${pad('what', w[1])}  ${pad('budget', w[2])}  ${pad('value', 12)}  ${pad('limit', 12)}  verdict`;
  const lines = rows.map((r) => {
    const v = Number.isFinite(r.value) ? `${Math.round(r.value * 10) / 10} ${r.unit}` : 'n/a';
    return `${pad(r.scenario, w[0])}  ${pad(r.label, w[1])}  ${pad(r.id, w[2])}  ${pad(v, 12)}  ${pad(`${r.limit} ${r.unit}`, 12)}  ${!r.pass ? 'FAIL' : r.reportOnly ? 'INFO' : 'PASS'}`;
  });
  return [head, '-'.repeat(head.length), ...lines].join('\n');
}
