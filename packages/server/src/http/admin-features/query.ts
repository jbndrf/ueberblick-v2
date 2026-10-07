/**
 * The request of the admin feature list, parsed and validated once. `FeatureQuery` is plain data (a later saved view can
 * store it, H5); `sql.ts` turns it into SQL and nothing else reads the URL.
 */
import { LIFECYCLE_STATES, type LifecycleState } from '@ueberblick/core';
import type { TypeColumns } from './columns';
import { DEFAULT_LIMIT, ID_COLUMN, MAX_LIMIT, SORT_DIRECTIONS, type SortDirection } from './registry';

export type Scalar = string | number | null;

export interface Cursor {
  readonly column: string;
  readonly dir: SortDirection;
  readonly value: Scalar;
  readonly id: string;
}

export interface FeatureQuery {
  readonly type: string;
  readonly search?: string;
  readonly sort: { readonly column: string; readonly dir: SortDirection };
  /** Column key to the values it may have (any of); `__empty__` stands for no value. */
  readonly filters: Readonly<Record<string, readonly string[]>>;
  readonly lifecycle: readonly LifecycleState[];
  readonly cursor?: Cursor;
  readonly limit: number;
  /** distinct only: the column whose values are counted. */
  readonly column?: string;
}

export type Parsed =
  { readonly ok: true; readonly query: FeatureQuery } | { readonly ok: false; readonly message: string };

export type Mode = 'list' | 'distinct';

const COMMON = new Set(['type', 'q', 'lifecycle']);
const LIST = new Set(['sort', 'dir', 'cursor', 'limit']);
const FILTER = 'filter.';

/** Lifecycle states shown when the request names none: everything but `deleted` (v3 hid deleted entries). */
export const DEFAULT_LIFECYCLES: readonly LifecycleState[] = LIFECYCLE_STATES.keys.filter(
  (k) => k !== 'deleted',
);

const bad = (message: string): Parsed => ({ ok: false, message });

/** `a,b\,c` to `['a', 'b,c']`. */
export function splitValues(raw: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as string;
    if (c === '\\' && raw[i + 1] === ',') {
      cur += ',';
      i++;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export const encodeCursor = (c: Cursor): string =>
  Buffer.from(JSON.stringify([c.column, c.dir, c.value, c.id])).toString('base64url');

function decodeCursor(raw: string): Cursor | undefined {
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(v) || v.length !== 4) return undefined;
    const [column, dir, value, id] = v as unknown[];
    if (typeof column !== 'string' || typeof id !== 'string' || !SORT_DIRECTIONS.has(String(dir)))
      return undefined;
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') return undefined;
    return { column, dir: dir as SortDirection, value, id };
  } catch {
    return undefined;
  }
}

export function parseQuery(params: URLSearchParams, mode: Mode, cols: TypeColumns): Parsed {
  const filters: Record<string, string[]> = {};
  for (const [k, v] of params.entries()) {
    if (k.startsWith(FILTER)) {
      const column = k.slice(FILTER.length);
      const c = cols.columns.get(column);
      if (c === undefined) return bad(`Unknown column '${column}' in ${k}.`);
      if (c.kind === 'opaque') return bad(`Column '${column}' cannot be filtered.`);
      (filters[column] ??= []).push(...splitValues(v));
    } else if (!COMMON.has(k) && !(mode === 'list' ? LIST.has(k) : k === 'column'))
      return bad(`Unknown query parameter '${k}'.`);
  }

  const type = params.get('type');
  if (type === null || type === '') return bad('type is required.');

  let lifecycle = DEFAULT_LIFECYCLES;
  const rawLife = params.get('lifecycle');
  if (rawLife !== null) {
    const states = splitValues(rawLife);
    const unknown = states.find((s) => !LIFECYCLE_STATES.has(s));
    if (unknown !== undefined || states.length === 0)
      return bad(`lifecycle must list states of: ${LIFECYCLE_STATES.keys.join(', ')}.`);
    lifecycle = states as LifecycleState[];
  }

  const search = params.get('q')?.trim();
  const base = {
    type,
    filters,
    lifecycle,
    ...(search ? { search } : {}),
  };

  if (mode === 'distinct') {
    const column = params.get('column');
    const c = column === null ? undefined : cols.columns.get(column);
    if (column === null || c === undefined) return bad(`column must name a column of '${type}'.`);
    if (c.kind === 'opaque') return bad(`Column '${column}' has no countable values.`);
    return { ok: true, query: { ...base, sort: { column: ID_COLUMN, dir: 'asc' }, limit: 0, column } };
  }

  const column = params.get('sort') ?? ID_COLUMN;
  const dir = params.get('dir') ?? 'asc';
  const sc = cols.columns.get(column);
  if (sc === undefined) return bad(`Unknown column '${column}' in sort.`);
  if (sc.kind === 'opaque' || sc.kind === 'array') return bad(`Column '${column}' cannot be sorted.`);
  if (!SORT_DIRECTIONS.has(dir)) return bad(`dir must be one of: ${SORT_DIRECTIONS.keys.join(', ')}.`);
  const sortDir = dir as SortDirection;

  let limit = DEFAULT_LIMIT;
  const rawLimit = params.get('limit');
  if (rawLimit !== null) {
    limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
      return bad(`limit must be an integer from 1 to ${MAX_LIMIT}.`);
  }

  let cursor: Cursor | undefined;
  const rawCursor = params.get('cursor');
  if (rawCursor !== null) {
    cursor = decodeCursor(rawCursor);
    if (cursor === undefined || cursor.column !== column || cursor.dir !== sortDir)
      return bad('cursor is not a cursor of this sort.');
  }
  return {
    ok: true,
    query: { ...base, sort: { column, dir: sortDir }, limit, ...(cursor ? { cursor } : {}) },
  };
}
