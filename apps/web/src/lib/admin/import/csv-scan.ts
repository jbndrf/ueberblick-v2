/**
 * What the wizard reads from the CSV in the browser (v3 `csv-import/parse-csv.ts`): the delimiter, the header row, the
 * first rows (for the 'Vorschau' column) and the number of data rows. It does not validate anything: the server's dry
 * run reads the file again and is the only judge of its rows (R1). One pass, memory of three rows.
 */
export interface CsvScan {
  readonly delimiter: string;
  readonly headers: readonly string[];
  /** The first data rows (at most `KEEP`). */
  readonly firstRows: readonly (readonly string[])[];
  /** Data rows that are not entirely empty. */
  readonly rowCount: number;
}

const KEEP = 3;
const CANDIDATES = [';', ',', '\t'] as const;

/** v3: the candidate that occurs most often outside quotes in the first line; comma on a tie at zero. */
function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const d of CANDIDATES) {
    let count = 0;
    let quoted = false;
    for (const ch of first) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

export function scanCsv(source: string): CsvScan {
  const text = source.startsWith('﻿') ? source.slice(1) : source;
  const delimiter = detectDelimiter(text);
  let headers: string[] | undefined;
  const firstRows: string[][] = [];
  let rowCount = 0;
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  const endRow = (): void => {
    row.push(cell);
    cell = '';
    const blank = row.every((c) => c.trim() === '');
    if (headers === undefined) {
      if (!blank) headers = row;
    } else if (!blank) {
      rowCount += 1;
      if (firstRows.length < KEEP) firstRows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (text[i + 1] !== '\n') endRow();
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) endRow();
  return { delimiter, headers: headers ?? [], firstRows, rowCount };
}
