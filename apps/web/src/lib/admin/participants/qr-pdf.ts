/**
 * "QR exportieren (n)" (v3 `lib/utils/qr-pdf-export.ts`): login badges on A4 paper, 2 columns by 4 rows, the QR code with
 * the name below it, 11 pt. Two changes from v3, both owner decisions: the QR holds the login link (a phone camera opens
 * it, a1 bug 11), and the code is drawn as vector squares from the encoder's module matrix instead of a PNG, so the
 * PDF is small and sharp at any print size. `layoutBadges` is pure and carries the content; jsPDF only draws it.
 */
import { qrModules } from './qr';

export interface BadgeEntry {
  readonly name: string;
  readonly link: string;
}

export interface Badge extends BadgeEntry {
  /** 0-based page. */
  readonly page: number;
  readonly col: number;
  readonly row: number;
  /** Top-left corner of the QR code, mm. */
  readonly qrX: number;
  readonly qrY: number;
  /** The centre line of the name, mm. */
  readonly textX: number;
  readonly textY: number;
}

export const COLS = 2;
export const ROWS = 4;
export const PER_PAGE = COLS * ROWS;
const MARGIN = 10;
const PAGE_W = 210;
const PAGE_H = 297;
const CELL_W = (PAGE_W - 2 * MARGIN) / COLS;
const CELL_H = (PAGE_H - 2 * MARGIN) / ROWS;
export const QR_SIZE = 45;
const NAME_PT = 11;
export const FILE_NAME = 'participants-qr-codes.pdf';

/** Where every badge goes (v3's numbers: 10 mm margin, QR 45 mm centred, name 6 mm below). */
export function layoutBadges(entries: readonly BadgeEntry[]): Badge[] {
  return entries.map((entry, i) => {
    const onPage = i % PER_PAGE;
    const col = onPage % COLS;
    const row = Math.floor(onPage / COLS);
    const cellX = MARGIN + col * CELL_W;
    const cellY = MARGIN + row * CELL_H;
    const qrY = cellY + 4;
    return {
      ...entry,
      page: Math.floor(i / PER_PAGE),
      col,
      row,
      qrX: cellX + (CELL_W - QR_SIZE) / 2,
      qrY,
      textX: cellX + CELL_W / 2,
      textY: qrY + QR_SIZE + 6,
    };
  });
}

/** Runs of dark modules in one row: [start, length]. Fewer, wider squares keep the PDF small. */
export function runsOf(row: readonly boolean[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  row.forEach((dark, i) => {
    if (dark && start < 0) start = i;
    if (!dark && start >= 0) {
      runs.push([start, i - start]);
      start = -1;
    }
  });
  if (start >= 0) runs.push([start, row.length - start]);
  return runs;
}

/** The PDF as a jsPDF document; the module is loaded on first use (a separate chunk). */
export async function buildQrPdf(entries: readonly BadgeEntry[]) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const badges = layoutBadges(entries);
  for (const badge of badges) {
    if (badge.page > 0 && badge.row === 0 && badge.col === 0) doc.addPage();
    const modules = await qrModules(badge.link);
    const cell = QR_SIZE / modules.length;
    modules.forEach((row, r) => {
      for (const [start, length] of runsOf(row))
        doc.rect(badge.qrX + start * cell, badge.qrY + r * cell, length * cell, cell, 'F');
    });
    doc.setFontSize(NAME_PT);
    // A long name wraps to a second line instead of running into the next badge.
    doc.text(doc.splitTextToSize(badge.name, CELL_W - 8).slice(0, 2), badge.textX, badge.textY, {
      align: 'center',
    });
  }
  return doc;
}

/** Builds the PDF and hands it to the browser as a download. */
export async function exportQrPdf(entries: readonly BadgeEntry[]): Promise<void> {
  (await buildQrPdf(entries)).save(FILE_NAME);
}
