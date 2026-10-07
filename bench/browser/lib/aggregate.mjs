// Combines the per-run rows of one scenario into one measurement per row (pure; run.mjs and the spec use it).
// Enforced rows are the median over the runs. A row with `aggregate: 'max'` is the worst single run and, with
// `info: true`, is only reported next to the enforced median, never judged (B-008).

const finite = (xs) => xs.filter(Number.isFinite).sort((a, b) => a - b);

export const median = (xs) => {
  const v = finite(xs);
  return v.length === 0
    ? Number.NaN
    : (v[Math.floor((v.length - 1) / 2)] + v[Math.ceil((v.length - 1) / 2)]) / 2;
};

const max = (xs) => {
  const v = finite(xs);
  return v.length === 0 ? Number.NaN : v[v.length - 1];
};

/**
 * @param {string} id scenario id
 * @param {{scenario?: string, label: string, budget: object, reportOnly?: boolean, aggregate?: 'median'|'max', info?: boolean, value: number}[][]} perRun
 */
export function aggregateRuns(id, perRun) {
  return (perRun[0] ?? []).map((row, k) => {
    const values = perRun.map((r) => r[k]?.value ?? Number.NaN);
    return {
      scenario: row.scenario ?? id,
      label: row.label,
      budget: row.budget,
      reportOnly: row.reportOnly === true,
      info: row.info === true,
      aggregate: row.aggregate === 'max' ? 'max' : 'median',
      value: row.aggregate === 'max' ? max(values) : median(values),
    };
  });
}
