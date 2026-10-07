// The docs/12 rows as `npm run bench` last stored them (metrics/raw/bench/<date>.json, field `rows`).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** @param {string} dir the bench result directory @returns {{date: string, rows: object[]} | null} */
export function latestBenchRows(dir) {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .at(-1);
  if (!file) return null;
  const json = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  return Array.isArray(json.rows) ? { date: file.slice(0, 10), rows: json.rows } : null;
}

/** Table cells: row, current adjusted value or "unmeasured", limit, lines that measure it, lines derived from it. */
export function rowCells(rows) {
  return rows.map((r) => [
    r.row,
    r.adjusted === undefined || r.adjusted === null ? 'unmeasured' : `${r.adjusted} ${r.unit}`,
    `${r.limit} ${r.unit}`,
    String(r.sources),
    String(r.derived),
  ]);
}
