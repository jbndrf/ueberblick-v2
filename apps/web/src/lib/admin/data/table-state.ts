/**
 * The data table's search, sort and filters survive a visit to an Objekt's detail page: the table writes its query here
 * when it changes and starts from it when it is built again ("‹ Zurück zu den Objekten" lands on the same table).
 * Per tab (sessionStorage), per project and Objektart. Storage may be missing or full (private window): then the table
 * starts empty, as in v3.
 */
import type { TableQuery } from '@ueberblick/ui/components/admin';

export type SavedQuery = Pick<TableQuery, 'search' | 'sort' | 'filters'>;

const key = (project: string, type: string): string => `ueberblick:admin-data-query:${project}:${type}`;

export function saveQuery(project: string, type: string, q: TableQuery): void {
  try {
    const empty = q.search === '' && q.sort === null && Object.values(q.filters).every((v) => v.length === 0);
    if (empty) sessionStorage.removeItem(key(project, type));
    else
      sessionStorage.setItem(
        key(project, type),
        JSON.stringify({ search: q.search, sort: q.sort, filters: q.filters }),
      );
  } catch {
    // no storage: the table starts empty next time
  }
}

export function loadQuery(project: string, type: string): SavedQuery | undefined {
  try {
    const raw = sessionStorage.getItem(key(project, type));
    if (raw === null) return undefined;
    const q = JSON.parse(raw) as Partial<SavedQuery>;
    if (typeof q.search !== 'string' || typeof q.filters !== 'object' || q.filters === null) return undefined;
    return { search: q.search, sort: q.sort ?? null, filters: q.filters };
  } catch {
    return undefined;
  }
}

/** The route of an Objekt's detail page. */
export const detailHref = (project: string, type: string, id: string): string =>
  `/admin/projects/${encodeURIComponent(project)}/types/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
