// Report row for the parity tracker (WP-1015): the total share of v3 elements done and verified. The math is
// scripts/metrics/parity.mjs (summarize, summaryLine); this only reads the file and shapes the row.
import { existsSync } from 'node:fs';
import { loadEntries, summarize, summaryLine } from './parity.mjs';

const FILE = 'metrics/parity/elements.json';

/** Table cells [metric, value, what it tells]; null when the elements file does not exist. */
export function parityRow(file = FILE) {
  if (!existsSync(file)) return null;
  return [
    'parity (v3 elements)',
    summaryLine(summarize(loadEntries(file))),
    'share of the v3 elements rebuilt (built or verified) and proven by a spec (`npm run -s parity`)',
  ];
}
