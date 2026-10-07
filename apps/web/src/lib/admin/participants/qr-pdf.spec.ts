import { describe, expect, it } from 'vitest';
import { decodeModules } from './qr-decode.testkit';
import { qrModules } from './qr';
import { PER_PAGE, buildQrPdf, layoutBadges, runsOf, type BadgeEntry } from './qr-pdf';
import { loginLink } from './table';

const entry = (i: number): BadgeEntry => ({
  name: `Person ${i}`,
  link: loginLink('https://ueb.test', `TOKEN-${String(i).padStart(4, '0')}-ABCD-EFGH-JKLM`),
});

describe('layoutBadges (v3 qr-pdf-export.ts:9-56: A4, 2 x 4)', () => {
  it('puts 8 badges on a page, row by row, and starts the next page after that', () => {
    const badges = layoutBadges(Array.from({ length: 10 }, (_, i) => entry(i)));
    expect(PER_PAGE).toBe(8);
    expect(badges.map((b) => b.page)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
    expect(badges.slice(0, 3).map((b) => [b.col, b.row])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
    ]);
    expect(badges[8]).toMatchObject({ col: 0, row: 0 });
  });

  it('keeps every QR code and name inside the page and out of the next badge', () => {
    for (const b of layoutBadges(Array.from({ length: 8 }, (_, i) => entry(i)))) {
      expect(b.qrX).toBeGreaterThanOrEqual(10);
      expect(b.qrX + 45).toBeLessThanOrEqual(200);
      expect(b.qrY + 45).toBeLessThan(b.textY);
      expect(b.textY).toBeLessThanOrEqual(297 - 10);
    }
  });

  it('is empty for no selection', () => expect(layoutBadges([])).toEqual([]));
});

describe('runsOf', () => {
  it('merges neighbouring dark modules of a row', () => {
    expect(runsOf([true, true, false, true, false, true, true, true])).toEqual([
      [0, 2],
      [3, 1],
      [5, 3],
    ]);
    expect(runsOf([false, false])).toEqual([]);
  });
});

describe('buildQrPdf: select 3 rows, get a PDF with 3 badges', () => {
  it('prints each name, and each QR code is the login link (not the raw token)', async () => {
    const entries = [entry(1), entry(2), entry(3)];
    const doc = await buildQrPdf(entries);
    const pdf = doc.output();
    expect(doc.getNumberOfPages()).toBe(1);
    for (const e of entries) expect(pdf).toContain(`(${e.name}) Tj`);

    // The code the encoder makes for the link decodes to the link, which carries the token as `?token=`.
    for (const e of entries) {
      expect(e.link).toMatch(/^https:\/\/ueb\.test\/login\?token=TOKEN-/);
      expect(decodeModules(await qrModules(e.link))).toBe(e.link);
    }
    // The PDF draws exactly the dark runs of those three codes: one `re` per run.
    let squares = 0;
    for (const e of entries)
      squares += (await qrModules(e.link)).reduce((n, row) => n + runsOf(row).length, 0);
    expect(pdf.match(/ re\n/g)).toHaveLength(squares);
  });

  it('10 selected rows give 2 pages (8 per page)', async () => {
    const doc = await buildQrPdf(Array.from({ length: 10 }, (_, i) => entry(i)));
    expect(doc.getNumberOfPages()).toBe(2);
    expect(doc.output().match(/\/Type \/Page(?![s\w])/g)).toHaveLength(2);
  });

  it('wraps a long name instead of running into the next badge, and keeps umlauts', async () => {
    const doc = await buildQrPdf([
      { name: 'Ärztin Übelacker-Müller '.repeat(4).trim(), link: entry(1).link },
    ]);
    expect(doc.output()).toContain('Tj');
  });
});

describe('2,000 badges (R14: layout stays linear)', () => {
  it('lays out 2,000 entries in one pass', () => {
    const entries = Array.from({ length: 2000 }, (_, i) => entry(i));
    const badges = layoutBadges(entries);
    expect(badges).toHaveLength(2000);
    expect(badges[1999]?.page).toBe(249);
  });
});
