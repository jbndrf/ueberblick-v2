/** Runs the statements of `sql.ts` and shapes the answer (rows, next cursor, total / values with counts). */
import { SYSTEM_FIELD_SIGIL, SYSTEM_FIELDS, type Json, type LifecycleState } from '@ueberblick/core';
import type { Db } from '../../db/driver';
import type { Column, TypeColumns } from './columns';
import { encodeCursor, type FeatureQuery, type Scalar } from './query';
import { DISTINCT_CAP, ID_COLUMN, SEQ_COLUMN } from './registry';
import { countSql, distinctSql, emptyCountSql, listSql } from './sql';

export interface FeatureRowOut {
  readonly [key: string]: Json | undefined;
  readonly $id: string;
  readonly $lifecycle: LifecycleState;
  readonly $created_by: string | null;
  readonly $created_at: string | null;
  readonly $changed_at: string | null;
  /** The Objekt's `updated_seq`: what `expected_seq` of the correction is checked against. */
  readonly $seq: number;
  readonly lon: number | null;
  readonly lat: number | null;
}

export interface FeaturePage {
  readonly rows: readonly FeatureRowOut[];
  /** The cursor of the next page; null on the last one. */
  readonly next: string | null;
  /** Rows matching every filter, over all pages. */
  readonly total: number;
}

export interface DistinctValue {
  readonly value: string | number | boolean | null;
  readonly count: number;
}

interface Raw {
  id: string;
  lifecycle: LifecycleState;
  created_by: string | null;
  created_at: string | null;
  changed_at: string | null;
  updated_seq: number;
  anchor_lon: number | null;
  anchor_lat: number | null;
  properties: string;
  sk: Scalar;
}

function shape(r: Raw, cols: TypeColumns): FeatureRowOut {
  const props = JSON.parse(r.properties) as Record<string, Json>;
  const row: Record<string, Json | undefined> = {};
  for (const [k, v] of Object.entries(props)) if (!cols.hidden.has(k)) row[k] = v;
  row[ID_COLUMN] = r.id;
  row[SEQ_COLUMN] = r.updated_seq;
  for (const f of SYSTEM_FIELDS.entries)
    row[`${SYSTEM_FIELD_SIGIL}${f.key}`] = r[f.column as keyof Raw] as string | null;
  return { ...row, lon: r.anchor_lon, lat: r.anchor_lat } as FeatureRowOut;
}

export function listFeatures(db: Db, q: FeatureQuery, cols: TypeColumns): FeaturePage {
  const list = listSql(q, cols);
  const raws = db.prepare<Raw>(list.sql).all(...list.params);
  const more = raws.length > q.limit;
  const page = more ? raws.slice(0, q.limit) : raws;
  const last = page[page.length - 1];
  const count = countSql(q, cols);
  const total = (db.prepare<{ n: number }>(count.sql).get(...count.params) as { n: number }).n;
  return {
    rows: page.map((r) => shape(r, cols)),
    next:
      more && last !== undefined
        ? encodeCursor({ column: q.sort.column, dir: q.sort.dir, value: last.sk ?? null, id: last.id })
        : null,
    total,
  };
}

const display = (c: Column, v: Scalar): DistinctValue['value'] =>
  c.kind === 'boolean' && v !== null ? v === 1 : v;

export function distinctValues(db: Db, q: FeatureQuery, cols: TypeColumns): DistinctValue[] {
  const c = cols.columns.get(q.column as string) as Column;
  const s = distinctSql(q, cols);
  const rows = db.prepare<{ v: Scalar; n: number }>(s.sql).all(...s.params);
  const out: DistinctValue[] = rows.map((r) => ({ value: display(c, r.v), count: r.n }));
  if (c.kind === 'array' && out.length < DISTINCT_CAP) {
    const e = emptyCountSql(q, cols);
    const n = (db.prepare<{ n: number }>(e.sql).get(...e.params) as { n: number }).n;
    if (n > 0) out.push({ value: null, count: n });
  }
  return out;
}

/** One feature of any lifecycle state as a list row (the detail page's header and Daten), or undefined. */
export function featureRow(
  db: Db,
  id: string,
  columnsOfType: (type: string) => TypeColumns | undefined,
): { readonly type: string; readonly row: FeatureRowOut } | undefined {
  const r = db
    .prepare<Raw & { type: string }>(
      `SELECT id, type, lifecycle, created_by, created_at, changed_at, updated_seq, anchor_lon, anchor_lat, properties, NULL AS sk
       FROM features WHERE id = ?`,
    )
    .get(id);
  const cols = r === undefined ? undefined : columnsOfType(r.type);
  return r === undefined || cols === undefined ? undefined : { type: r.type, row: shape(r, cols) };
}
