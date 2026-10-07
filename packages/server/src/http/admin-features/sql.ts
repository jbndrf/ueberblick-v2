/**
 * `FeatureQuery` to SQL: pure functions, no database. The only statements of the admin feature list (list, count,
 * distinct values, empty count of an array column). Keyset paging on (sort value, id): a page costs the same at any depth.
 * Every value is a bound parameter; column SQL comes from `columns.ts`, whose keys are validated config keys.
 */
import { propertySql } from '@ueberblick/core';
import { noCase } from '../../deploy/index-ddl';
import type { Column, TypeColumns } from './columns';
import type { FeatureQuery, Scalar } from './query';
import { DISTINCT_CAP, EMPTY_VALUE, ID_COLUMN } from './registry';

export type Param = string | number;
export interface Sql {
  readonly sql: string;
  readonly params: Param[];
}

const placeholders = (n: number): string => Array(n).fill('?').join(',');

/** The SQL a column is sorted by: every text column compares case-insensitively (ids and timestamps stay binary), so order never depends on an index. */
function sortSql(c: Column): string {
  return c.kind === 'text' && !c.binary ? noCase(c.sql) : c.sql;
}

/** Filter values as the column stores them; a value the column cannot hold matches nothing. */
function bound(c: Column, values: readonly string[]): Param[] {
  const out: Param[] = [];
  for (const v of values) {
    if (c.kind === 'number') {
      const n = Number(v);
      if (v.trim() !== '' && Number.isFinite(n)) out.push(n);
    } else if (c.kind === 'boolean') {
      if (v === 'true') out.push(1);
      else if (v === 'false') out.push(0);
    } else out.push(v);
  }
  return out;
}

/** Rows without a value of the column. */
function emptySql(c: Column, key: string): string {
  if (c.kind === 'array') {
    const path = propertySql('f', key);
    return `(${path} IS NULL OR json_array_length(${path}) = 0)`;
  }
  return c.kind === 'text' ? `(${c.sql} IS NULL OR ${c.sql} = '')` : `${c.sql} IS NULL`;
}

function filterClause(c: Column, key: string, values: readonly string[]): Sql {
  const wantsEmpty = values.includes(EMPTY_VALUE);
  const vals = bound(
    c,
    values.filter((v) => v !== EMPTY_VALUE),
  );
  const parts: string[] = [];
  const params: Param[] = [];
  if (vals.length > 0) {
    if (c.kind === 'array') {
      parts.push(
        `EXISTS (SELECT 1 FROM json_each(${propertySql('f', key)}) j WHERE j.value IN (${placeholders(vals.length)}))`,
      );
    } else parts.push(`${c.sql} IN (${placeholders(vals.length)})`);
    params.push(...vals);
  }
  if (wantsEmpty) parts.push(emptySql(c, key));
  return { sql: parts.length === 0 ? '0' : `(${parts.join(' OR ')})`, params };
}

/** Characters JSON escapes in a stored string: a term with one cannot be looked for in the raw `properties` text. */
const hasJsonEscape = (term: string): boolean =>
  [...term].some((ch) => ch === '"' || ch === '\\' || ch.charCodeAt(0) < 0x20);

/**
 * Substring search over the text properties and "Erstellt von". The precise test reads every text property
 * (`json_extract` each); a cheap necessary test in front (one LIKE over the raw `properties` text) lets most rows skip
 * it. The raw text holds the values unescaped unless the term has a character JSON escapes, then only the precise test runs.
 */
function searchClause(cols: TypeColumns, term: string): Sql {
  const text = textSearchClause(cols, term);
  const short = SHORT_ID_TERM.exec(term);
  if (short === null) return text;
  // A short id as the page shows it ("#4139", core `shortId`): also the features whose id ends with it. Same scan (R14).
  const tail = (short[1] as string).replace(/[\\%_]/g, (m) => `\\${m}`);
  return { sql: `(${text.sql} OR f.id LIKE ? ESCAPE '\\')`, params: [...text.params, `%${tail}`] };
}

/** `#` optional, then 1 to 4 characters of the id alphabet (core `shortId` is `#` + the last four). */
const SHORT_ID_TERM = /^#?([0-9a-zA-Z-]{1,4})$/;

function textSearchClause(cols: TypeColumns, term: string): Sql {
  const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const parts = cols.searchable.map((s) => `${s} LIKE ? ESCAPE '\\'`);
  const exact = `(${parts.join(' OR ')})`;
  if (hasJsonEscape(term)) return { sql: exact, params: parts.map(() => like) };
  return {
    sql: `((f.properties LIKE ? ESCAPE '\\' OR f.created_by LIKE ? ESCAPE '\\') AND ${exact})`,
    params: [like, like, ...parts.map(() => like)],
  };
}

/** The filters of a query: type, lifecycle, search, column filters (not the one of `omit`). */
export function whereOf(q: FeatureQuery, cols: TypeColumns, omit?: string): Sql {
  const clauses = ['f.type = ?', `f.lifecycle IN (${placeholders(q.lifecycle.length)})`];
  const params: Param[] = [q.type, ...q.lifecycle];
  if (q.search !== undefined) {
    const s = searchClause(cols, q.search);
    clauses.push(s.sql);
    params.push(...s.params);
  }
  for (const [key, values] of Object.entries(q.filters)) {
    if (key === omit) continue;
    const c = cols.columns.get(key) as Column;
    const f = filterClause(c, key, values);
    clauses.push(f.sql);
    params.push(...f.params);
  }
  return { sql: clauses.join(' AND '), params };
}

function keyset(q: FeatureQuery, kx: string): Sql | undefined {
  const cur = q.cursor;
  if (cur === undefined) return undefined;
  const asc = q.sort.dir === 'asc';
  const op = asc ? '>' : '<';
  if (q.sort.column === ID_COLUMN) return { sql: `f.id ${op} ?`, params: [cur.id] };
  const v: Scalar = cur.value;
  if (v === null)
    return asc
      ? { sql: `((${kx} IS NULL AND f.id > ?) OR ${kx} IS NOT NULL)`, params: [cur.id] }
      : { sql: `(${kx} IS NULL AND f.id < ?)`, params: [cur.id] };
  return {
    sql: `(${kx} ${op} ? OR (${kx} = ? AND f.id ${op} ?)${asc ? '' : ` OR ${kx} IS NULL`})`,
    params: [v, v, cur.id],
  };
}

/** One page (limit + 1 rows, so the caller sees whether there is a next one). */
export function listSql(q: FeatureQuery, cols: TypeColumns): Sql {
  const where = whereOf(q, cols);
  const sc = cols.columns.get(q.sort.column) as Column;
  const kx = sortSql(sc);
  const k = keyset(q, kx);
  const dir = q.sort.dir === 'asc' ? 'ASC' : 'DESC';
  const order = q.sort.column === ID_COLUMN ? `f.id ${dir}` : `${kx} ${dir}, f.id ${dir}`;
  return {
    sql: `SELECT f.id, f.lifecycle, f.created_by, f.created_at, f.changed_at, f.updated_seq, f.anchor_lon, f.anchor_lat, f.properties, ${sc.sql} AS sk
FROM features f WHERE ${where.sql}${k ? ` AND ${k.sql}` : ''} ORDER BY ${order} LIMIT ?`,
    params: [...where.params, ...(k?.params ?? []), q.limit + 1],
  };
}

export function countSql(q: FeatureQuery, cols: TypeColumns): Sql {
  const where = whereOf(q, cols);
  return { sql: `SELECT COUNT(*) AS n FROM features f WHERE ${where.sql}`, params: where.params };
}

/** The values of `q.column` with counts, under every filter except the column's own. */
export function distinctSql(q: FeatureQuery, cols: TypeColumns): Sql {
  const key = q.column as string;
  const c = cols.columns.get(key) as Column;
  const where = whereOf(q, cols, key);
  const from = c.kind === 'array' ? `features f, json_each(${propertySql('f', key)}) j` : 'features f';
  const value = c.kind === 'array' ? 'j.value' : c.sql;
  return {
    sql: `SELECT ${value} AS v, COUNT(*) AS n FROM ${from} WHERE ${where.sql} GROUP BY v ORDER BY n DESC, v LIMIT ${DISTINCT_CAP}`,
    params: where.params,
  };
}

/** Rows without an entry in an array column (`distinctSql` cannot count them). */
export function emptyCountSql(q: FeatureQuery, cols: TypeColumns): Sql {
  const key = q.column as string;
  const c = cols.columns.get(key) as Column;
  const where = whereOf(q, cols, key);
  return {
    sql: `SELECT COUNT(*) AS n FROM features f WHERE ${where.sql} AND ${emptySql(c, key)}`,
    params: where.params,
  };
}
