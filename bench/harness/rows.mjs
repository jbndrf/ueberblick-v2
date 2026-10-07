// The docs/12 table with what the benchmarks currently show for each row (adjusted values, or "unmeasured").
// Only a line that IS the row (`row`) measures it; lines that derive a share from it are counted separately.
import { DOC_BUDGETS } from './budget.mjs';

/**
 * The row shows the worst adjusted value of the lines with that `row`; `derived` counts the lines whose
 * `derivedFrom` names it.
 * @param {{row?: string, derivedFrom?: string, adjusted: number}[]} lines
 */
export function docRows(lines) {
  return Object.values(DOC_BUDGETS).map((b) => {
    const mine = lines.filter((l) => l.row === b.id);
    const adjusted = mine.length ? Math.max(...mine.map((l) => l.adjusted)) : undefined;
    const derived = lines.filter((l) => !l.row && (l.derivedFrom ?? '').includes(b.id)).length;
    return { row: b.id, limit: b.limit, unit: b.unit, adjusted, sources: mine.length, derived };
  });
}

/** @param {ReturnType<typeof docRows>} rows */
export function renderRows(rows) {
  const w = Math.max(...rows.map((r) => r.row.length));
  return rows
    .map((r) => {
      const v = r.adjusted === undefined ? 'unmeasured' : `${Math.round(r.adjusted * 1000) / 1000} ${r.unit}`;
      return `  ${r.row.padEnd(w)}  ${v.padEnd(14)}  / ${r.limit} ${r.unit}  (${r.sources} direct, ${r.derived} derived)`;
    })
    .join('\n');
}
