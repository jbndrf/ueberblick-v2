/**
 * The columns of the Teilnehmende table that are the admin's own (v3's custom-field manager: Feldname, Feldtyp,
 * Standardwert, Pflichtfeld), and the check of a participant's `attrs` against them. `attrs` is one JSON object:
 * `email` and `phone` are fixed keys, every other key is a column of the project. Definitions are data, so a later
 * column type (a team, H3/O12) is a registry entry, not a schema change.
 */
import { KeySchema } from '@ueberblick/core';
import type { Db } from '../../db/driver';
import { PARTICIPANT_COLUMN_TYPES, type ParticipantColumnType, type ParticipantErrorCode } from './registry';

export interface ColumnDef {
  readonly key: string;
  readonly label: string;
  readonly type: ParticipantColumnType;
  /** Applied when a participant is added without a value for the column. */
  readonly default?: AttrValue;
  readonly required?: boolean;
}

export type AttrValue = string | number | boolean;
export type Attrs = Readonly<Record<string, AttrValue>>;

/** The keys of `attrs` that are not columns. */
export const FIXED_ATTRS = ['email', 'phone'] as const;

export type Checked =
  | { readonly ok: true; readonly attrs: Attrs }
  | { readonly ok: false; readonly code: ParticipantErrorCode; readonly detail: string };

interface Row {
  key: string;
  label: string;
  type: string;
  default_value: string | null;
  required: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fits(type: ParticipantColumnType, v: unknown): v is AttrValue {
  switch (type) {
    case 'text':
      return typeof v === 'string';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'date':
      return typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v));
  }
}

export function listColumns(db: Db): readonly ColumnDef[] {
  return db
    .prepare<Row>(
      'SELECT key, label, type, default_value, required FROM participant_columns ORDER BY position',
    )
    .all()
    .map((r) => ({
      key: r.key,
      label: r.label,
      type: r.type as ParticipantColumnType,
      ...(r.default_value !== null ? { default: JSON.parse(r.default_value) as AttrValue } : {}),
      required: r.required === 1,
    }));
}

/** Replaces the column definitions (one transaction). The array order is the column order. */
export function setColumns(
  db: Db,
  defs: readonly ColumnDef[],
): { readonly ok: true } | { readonly ok: false; readonly code: 'invalid_columns'; readonly detail: string } {
  const seen = new Set<string>();
  for (const d of defs) {
    const bad =
      !KeySchema.safeParse(d.key).success ||
      (FIXED_ATTRS as readonly string[]).includes(d.key) ||
      seen.has(d.key) ||
      d.label.trim() === '' ||
      !PARTICIPANT_COLUMN_TYPES.has(d.type) ||
      (d.default !== undefined && !fits(d.type, d.default));
    if (bad) return { ok: false, code: 'invalid_columns', detail: d.key };
    seen.add(d.key);
  }
  db.transaction(() => {
    db.prepare('DELETE FROM participant_columns').run();
    const ins = db.prepare(
      'INSERT INTO participant_columns (key, label, type, default_value, required, position) VALUES (?,?,?,?,?,?)',
    );
    defs.forEach((d, i) =>
      ins.run(
        d.key,
        d.label.trim(),
        d.type,
        d.default === undefined ? null : JSON.stringify(d.default),
        d.required ? 1 : 0,
        i,
      ),
    );
  });
  return { ok: true };
}

/**
 * Checks the custom values of `attrs` against the columns. `merge` is the stored custom values of an update (the
 * patch is laid over them; `null` clears a value); an add passes none and gets the defaults applied. Every required
 * column must end up with a non-empty value. The fixed keys `email` and `phone` are not handled here.
 */
export function checkColumns(db: Db, patch: Readonly<Record<string, unknown>>, stored?: Attrs): Checked {
  const columns = listColumns(db);
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const out = new Map<string, AttrValue>(Object.entries(stored ?? {}));
  for (const [key, v] of Object.entries(patch)) {
    const col = byKey.get(key);
    if (!col) return { ok: false, code: 'unknown_column', detail: key };
    if (v === null || v === '') out.delete(key);
    else if (fits(col.type, v)) out.set(key, v);
    else return { ok: false, code: 'column_value_invalid', detail: key };
  }
  for (const col of columns) {
    if (!out.has(col.key) && stored === undefined && col.default !== undefined) out.set(col.key, col.default);
    if (col.required && !out.has(col.key)) return { ok: false, code: 'column_required', detail: col.key };
  }
  return { ok: true, attrs: Object.fromEntries(out) };
}
