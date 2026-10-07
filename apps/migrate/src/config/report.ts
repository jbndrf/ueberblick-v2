/**
 * The conversion report: every v3 item is mapped, approximated or dropped, with a reason unless
 * mapped. Several notes on one item merge to the worst status. Whatever the converter did not
 * touch is added at the end as dropped with the reason "not handled", so the report always
 * accounts for 100% of the input; the tests assert that no fixture triggers that fallback.
 */
import type { Problem } from '@ueberblick/core';
import { STATUS_RANK, type ReportStatus } from './registry';

export interface ReportItem {
  /** The v3 path of the item, e.g. `workflows.baum.tasks.kontrolle.conditions.0`. */
  readonly id: string;
  readonly status: ReportStatus;
  /** Why it is approximated or dropped; empty when mapped. */
  readonly reason: string;
  /** Where it went in the v4 files (a key path), when it went anywhere. */
  readonly target?: string;
}

export interface ReportSummary {
  readonly total: number;
  readonly mapped: number;
  readonly approximated: number;
  readonly dropped: number;
}

export interface ConversionReport {
  readonly items: readonly ReportItem[];
  /** Ids the converter reported that are not in the input: always empty unless the converter has a bug. */
  readonly stray: readonly string[];
  /** What `compile` warns about in the converted project (for example an option that no task sets), so an admin sees it. */
  readonly warnings: readonly Problem[];
  readonly summary: ReportSummary;
}

/** Reason of the fallback for items that no converter step touched. */
export const NOT_HANDLED = 'not handled by the converter; review this item by hand';

/** A default outcome per known record column (`Report.columns`). */
export type Disposition = readonly [ReportStatus, (string | undefined)?, (string | undefined)?];

/** Columns that every v3 record carries besides its own data. */
const COMMON: Readonly<Record<string, Disposition>> = {
  key: ['mapped', undefined, 'the key of the entity'],
  created: ['dropped', 'operational timestamp; v4 keeps history as observations'],
  updated: ['dropped', 'operational timestamp; v4 keeps history as observations'],
};

export class Report {
  private readonly entries = new Map<string, { status: ReportStatus; reasons: string[]; target?: string }>();
  /** Ids that were reported but do not exist in the input (a converter bug; tests assert none). */
  readonly unknown: string[] = [];
  private readonly known: Set<string>;

  constructor(inventory: readonly string[]) {
    this.known = new Set(inventory);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Record a note. The worst status wins; reasons and the first target are kept. */
  note(id: string, status: ReportStatus, reason?: string, target?: string): void {
    if (!this.known.has(id)) this.unknown.push(id);
    const cur = this.entries.get(id);
    if (!cur) {
      this.entries.set(id, { status, reasons: reason ? [reason] : [], ...(target ? { target } : {}) });
      return;
    }
    if (STATUS_RANK[status] > STATUS_RANK[cur.status]) cur.status = status;
    if (reason && !cur.reasons.includes(reason)) cur.reasons.push(reason);
    if (target && cur.target === undefined) cur.target = target;
  }

  mapped(id: string, target?: string): void {
    this.note(id, 'mapped', undefined, target);
  }

  approximated(id: string, reason: string, target?: string): void {
    this.note(id, 'approximated', reason, target);
  }

  dropped(id: string, reason: string): void {
    this.note(id, 'dropped', reason);
  }

  /**
   * Account for the columns of a v3 record that no earlier step reported, using the default per
   * column. A column that is not in the table is dropped as unknown.
   */
  columns(id: string, record: Record<string, unknown>, table: Readonly<Record<string, Disposition>>): void {
    for (const column of Object.keys(record)) {
      const cid = `${id}.${column}`;
      if (this.has(cid)) continue;
      const d = table[column] ?? COMMON[column];
      if (d) this.note(cid, d[0], d[1], d[2]);
      else this.dropped(cid, `unknown v3 column "${column}" has no v4 counterpart`);
    }
  }

  finish(inventory: readonly string[], warnings: readonly Problem[]): ConversionReport {
    const items: ReportItem[] = inventory.map((id) => {
      const e = this.entries.get(id);
      if (!e) return { id, status: 'dropped', reason: NOT_HANDLED };
      return {
        id,
        status: e.status,
        reason: e.reasons.join('; '),
        ...(e.target ? { target: e.target } : {}),
      };
    });
    const count = (s: ReportStatus): number => items.filter((i) => i.status === s).length;
    return {
      items,
      stray: [...new Set(this.unknown)],
      warnings,
      summary: {
        total: items.length,
        mapped: count('mapped'),
        approximated: count('approximated'),
        dropped: count('dropped'),
      },
    };
  }
}
