/** The requests of the data page: a table query (`TableQuery`) as the admin feature list's URL (WP-313, `features-api.md`). */
import { LIFECYCLE_STATES, SYSTEM_FIELD_SIGIL } from '@ueberblick/core';
import type { TableQuery } from '@ueberblick/ui/components/admin';

/** v3 loaded its rows in pages of 200 (`ADMIN_FEATURE_PAGE_SIZE`). */
export const PAGE_SIZE = 200;
export const LIFECYCLE_COLUMN = `${SYSTEM_FIELD_SIGIL}lifecycle`;
const ALL_STATES = LIFECYCLE_STATES.keys.join(',');

/** A comma inside a value is written `\,` (the API splits on commas). */
const escapeValue = (v: string): string => v.replaceAll(',', '\\,');

function common(p: URLSearchParams, type: string, q: TableQuery, skip?: string): void {
  p.set('type', type);
  if (q.search !== '') p.set('q', q.search);
  for (const [column, values] of Object.entries(q.filters)) {
    if (column === skip || values.length === 0) continue;
    p.set(`filter.${column}`, values.map(escapeValue).join(','));
  }
  // The API hides deleted ones unless asked; a status filter must be able to ask for them.
  if (q.filters[LIFECYCLE_COLUMN]?.length) p.set('lifecycle', ALL_STATES);
}

/** `GET features`: one page after `cursor` (null for the first). */
export function listUrl(project: string, type: string, q: TableQuery, cursor: string | null): string {
  const p = new URLSearchParams();
  common(p, type, q);
  if (q.sort) {
    p.set('sort', q.sort.key);
    p.set('dir', q.sort.direction);
  }
  p.set('limit', String(PAGE_SIZE));
  if (cursor !== null) p.set('cursor', cursor);
  return `/api/admin/p/${encodeURIComponent(project)}/features?${p}`;
}

/** `GET features` for one Objekt in any lifecycle state: its row again after a correction. */
export function rowUrl(project: string, type: string, id: string): string {
  const p = new URLSearchParams();
  p.set('type', type);
  p.set(`filter.${SYSTEM_FIELD_SIGIL}id`, id);
  p.set('lifecycle', ALL_STATES);
  return `/api/admin/p/${encodeURIComponent(project)}/features?${p}`;
}

/** `GET features/distinct`: the values of one column with counts, under the other filters. */
export function distinctUrl(project: string, type: string, column: string, q: TableQuery): string {
  const p = new URLSearchParams();
  common(p, type, q, column);
  p.set('column', column);
  if (column === LIFECYCLE_COLUMN) p.set('lifecycle', ALL_STATES);
  return `/api/admin/p/${encodeURIComponent(project)}/features/distinct?${p}`;
}
