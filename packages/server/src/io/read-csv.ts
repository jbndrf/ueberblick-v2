/** CSV reader: RFC 4180 quoting, BOM, `;` or `,`, lazy (one record at a time). Geometry from x/y(/z) columns. */
import type { Position } from '@ueberblick/core';
import type { ImportMapping, ImportRow, ReadResult } from './contract';
import { ImportFileError } from './errors';

const NUMBER = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/;

/** A number with `.` or (German) `,` as decimal mark; `undefined` when it is not one. */
export function parseNumber(text: string): number | undefined {
  const t = text.trim();
  if (!NUMBER.test(t)) return undefined;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** Records of the text, lazily. A quoted field may hold the delimiter, quotes ("") and line breaks. */
export function* csvRecords(text: string, delimiter: string): Generator<string[]> {
  let i = 0;
  const n = text.length;
  while (i < n) {
    const record: string[] = [];
    for (;;) {
      let field = '';
      if (text[i] === '"') {
        i++;
        for (;;) {
          if (i >= n) throw new ImportFileError('unterminated quoted field');
          const c = text[i] as string;
          if (c === '"') {
            if (text[i + 1] === '"') {
              field += '"';
              i += 2;
              continue;
            }
            i++;
            break;
          }
          field += c;
          i++;
        }
      } else {
        const start = i;
        while (i < n && text[i] !== delimiter && text[i] !== '\n' && text[i] !== '\r') i++;
        field = text.slice(start, i);
      }
      record.push(field);
      if (text[i] === delimiter) {
        i++;
        continue;
      }
      break;
    }
    if (text[i] === '\r') i++;
    if (text[i] === '\n') i++;
    if (record.length === 1 && record[0] === '') continue; // blank line
    yield record;
  }
}

export function decodeText(data: Uint8Array | string): string {
  const s = typeof data === 'string' ? data : new TextDecoder('utf-8', { fatal: true }).decode(data);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function detectDelimiter(text: string): string {
  const head = text.slice(0, text.search(/\r|\n|$/));
  return head.split(';').length > head.split(',').length ? ';' : ',';
}

export function readCsv(data: Uint8Array | string, mapping: ImportMapping): ReadResult {
  let text: string;
  try {
    text = decodeText(data);
  } catch {
    throw new ImportFileError('the file is not valid UTF-8');
  }
  const records = csvRecords(text, mapping.delimiter ?? detectDelimiter(text));
  const head = records.next();
  if (head.done) throw new ImportFileError('the file has no header row');
  const header = head.value.map((h) => h.normalize('NFC').trim());
  const geo = mapping.geometry;
  const at = (name: string | undefined): number =>
    name === undefined ? -1 : header.indexOf(name.normalize('NFC'));
  const [xi, yi, zi] = [at(geo?.x), at(geo?.y), at(geo?.z)];
  if (geo?.x !== undefined && xi < 0) throw new ImportFileError(`no column "${geo.x}"`);
  if (geo?.y !== undefined && yi < 0) throw new ImportFileError(`no column "${geo.y}"`);
  if (geo?.z !== undefined && zi < 0) throw new ImportFileError(`no column "${geo.z}"`);

  const rows = (function* (): Generator<ImportRow> {
    let row = 0;
    for (const rec of records) {
      row++;
      if (rec.length !== header.length) {
        yield {
          row,
          values: {},
          problem: {
            code: 'row_malformed',
            message: `${rec.length} columns, the header has ${header.length}`,
          },
        };
        continue;
      }
      const values: Record<string, string> = {};
      header.forEach((h, k) => {
        values[h] = rec[k] as string;
      });
      if (xi < 0 || yi < 0) {
        yield { row, values };
        continue;
      }
      const x = parseNumber(rec[xi] as string);
      const y = parseNumber(rec[yi] as string);
      const zText = zi < 0 ? '' : (rec[zi] as string).trim();
      const z = zText === '' ? undefined : parseNumber(zText);
      if (x === undefined || y === undefined || (zText !== '' && z === undefined)) {
        yield { row, values, problem: { code: 'geometry_invalid', message: 'x, y or z is not a number' } };
        continue;
      }
      const coordinates: Position = z === undefined ? [x, y] : [x, y, z];
      yield { row, values, geometry: { type: 'Point', coordinates } };
    }
  })();
  return { rows };
}
