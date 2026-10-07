import { describe, expect, it } from 'vitest';
import { scanCsv } from './csv-scan';

describe('scanCsv: what the mapping step needs from the file (v3 parse-csv.ts)', () => {
  it('reads headers, the first rows and the number of data rows', () => {
    const r = scanCsv('Art;Höhe\nEiche;12\nBuche;9\n\nLinde;4\n');
    expect(r.delimiter).toBe(';');
    expect(r.headers).toEqual(['Art', 'Höhe']);
    expect(r.rowCount).toBe(3);
    expect(r.firstRows).toEqual([
      ['Eiche', '12'],
      ['Buche', '9'],
      ['Linde', '4'],
    ]);
  });

  it('detects comma and tab, and ignores delimiters inside quotes', () => {
    expect(scanCsv('a,b\n1,2').delimiter).toBe(',');
    expect(scanCsv('a\tb\n1\t2').delimiter).toBe('\t');
    const r = scanCsv('"a;x",b,c\n"1;2",3,4');
    expect(r.delimiter).toBe(',');
    expect(r.headers).toEqual(['a;x', 'b', 'c']);
    expect(r.firstRows[0]).toEqual(['1;2', '3', '4']);
  });

  it('handles quoted newlines, escaped quotes, CRLF and a BOM', () => {
    const r = scanCsv('﻿name,note\r\n"Ei""che","a\nb"\r\nx,y\r\n');
    expect(r.headers).toEqual(['name', 'note']);
    expect(r.firstRows[0]).toEqual(['Ei"che', 'a\nb']);
    expect(r.rowCount).toBe(2);
  });

  it('keeps only the first three rows however long the file is', () => {
    const text = 'a\n' + Array.from({ length: 5000 }, (_, i) => String(i)).join('\n');
    const r = scanCsv(text);
    expect(r.rowCount).toBe(5000);
    expect(r.firstRows).toHaveLength(3);
  });

  it('an empty file has no headers', () => {
    expect(scanCsv('').headers).toEqual([]);
    expect(scanCsv('\n\n').headers).toEqual([]);
  });
});
