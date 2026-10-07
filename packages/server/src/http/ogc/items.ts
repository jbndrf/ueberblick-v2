/**
 * Reads of one collection: a page of rows (keyset on the row id, so a page costs the same at any depth) and one row.
 * Row visibility is `SyncService.visible` (R1), never rebuilt here. Every statement is bounded: by `LIMIT`, and for a
 * residual filter also by `RESIDUAL_SCAN_CAP` candidate rows, above which the request is refused, not truncated (R14).
 */
import { servedSql, type Bbox, type FeatureId } from '@ueberblick/core';
import { viewportPageFrom } from '@ueberblick/core/expr/compile';
import type { Db } from '../../db/driver';
import type { Predicate } from '../../sync';
import type { FeatureRow } from './feature';
import type { FilterPlan } from './filter';
import { intersect } from './filter';

/** Candidates a residual filter may examine per request. */
export const RESIDUAL_SCAN_CAP = 5000;

const VIEWPORT = viewportPageFrom({ feature: 'f', box: 'r' });
const COLUMNS = 'f.rowid AS rid, f.id, f.type, f.properties, f.geometry';

export interface Page {
  readonly rows: readonly FeatureRow[];
  /** The cursor of the next page, or undefined on the last one. */
  readonly next?: number;
}

export type PageResult =
  { readonly ok: true; readonly page: Page } | { readonly ok: false; readonly message: string };

export interface PageRequest {
  /** Candidates a residual filter may examine; default `RESIDUAL_SCAN_CAP`. */
  readonly scanCap?: number;
  readonly type: string;
  readonly visible: Predicate;
  readonly limit: number;
  readonly after: number;
  readonly bbox?: Bbox;
  readonly filter?: FilterPlan;
}

type Param = string | number;

function statement(
  r: PageRequest,
  box: Bbox | undefined,
  after: number,
  take: number,
): { sql: string; params: Param[] } {
  const from = box === undefined ? 'FROM features f' : VIEWPORT.from;
  const near = box === undefined ? '' : `AND ${VIEWPORT.near}`;
  const where = r.filter?.where;
  const sql = `SELECT ${COLUMNS} ${from}
    WHERE f.type = ? AND ${servedSql('f.lifecycle')} AND f.rowid > ? ${near} AND ${r.visible.sql}${where === undefined ? '' : ` AND ${where.sql}`}
    ORDER BY f.rowid LIMIT ?`;
  const params: Param[] = [r.type, after];
  if (box !== undefined) params.push(...VIEWPORT.args(box));
  params.push(...(r.visible.params as Param[]), ...((where?.params ?? []) as Param[]), take);
  return { sql, params };
}

export function readPage(db: Db, r: PageRequest): PageResult {
  const box =
    r.bbox !== undefined && r.filter?.bbox !== undefined
      ? intersect(r.bbox, r.filter.bbox)
      : (r.bbox ?? r.filter?.bbox);
  if (box !== undefined && (box[0] > box[2] || box[1] > box[3])) return { ok: true, page: { rows: [] } };
  const query = (after: number, take: number): FeatureRow[] => {
    const { sql, params } = statement(r, box, after, take);
    return db.prepare<FeatureRow>(sql).all(...params);
  };
  const residual = r.filter?.residual;
  if (residual === undefined) {
    const batch = query(r.after, r.limit + 1);
    const more = batch.length > r.limit;
    const rows = more ? batch.slice(0, r.limit) : batch;
    return { ok: true, page: { rows, ...(more ? { next: (rows[rows.length - 1] as FeatureRow).rid } : {}) } };
  }
  const cap = r.scanCap ?? RESIDUAL_SCAN_CAP;
  const rows: FeatureRow[] = [];
  const size = Math.max(r.limit * 2, 50);
  let after = r.after;
  let scanned = 0;
  for (;;) {
    const take = Math.min(size, cap - scanned);
    const batch = query(after, take);
    for (const row of batch) {
      scanned++;
      after = row.rid;
      if (!residual(row.id as FeatureId)) continue;
      if (rows.length === r.limit)
        return { ok: true, page: { rows, next: (rows[rows.length - 1] as FeatureRow).rid } };
      rows.push(row);
    }
    if (batch.length < take) return { ok: true, page: { rows } };
    if (scanned >= cap)
      return {
        ok: false,
        message: `The filter needs more than ${cap} candidate features to be checked. Narrow the bbox or add a condition on a property.`,
      };
  }
}

export function readOne(db: Db, type: string, id: string, visible: Predicate): FeatureRow | undefined {
  return db
    .prepare<FeatureRow>(
      `SELECT ${COLUMNS} FROM features f WHERE f.id = ? AND f.type = ? AND ${servedSql('f.lifecycle')} AND ${visible.sql}`,
    )
    .get(id, type, ...(visible.params as Param[]));
}
