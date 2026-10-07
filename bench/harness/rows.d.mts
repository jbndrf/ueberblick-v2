export interface DocRow {
  readonly row: string;
  readonly limit: number;
  readonly unit: string;
  /** Worst adjusted value of the lines that name the row; undefined = unmeasured. */
  readonly adjusted: number | undefined;
  readonly sources: number;
  /** Lines that derive their limit from the row (they do not measure it). */
  readonly derived: number;
}
export function docRows(lines: readonly { row?: string; derivedFrom?: string; adjusted: number }[]): DocRow[];
export function renderRows(rows: readonly DocRow[]): string;
