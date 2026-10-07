/** The next page of a feature's history from `GET /api/admin/p/<project>/features/<id>/history` (E-9); null when the request failed. */
import type { HistoryPage } from '@ueberblick/server';

export const historyUrl = (project: string, id: string, cursor: string | null): string =>
  `/api/admin/p/${encodeURIComponent(project)}/features/${encodeURIComponent(id)}/history${
    cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`
  }`;

export async function nextHistory(
  project: string,
  id: string,
  cursor: string | null,
  get: (url: string) => Promise<Response>,
): Promise<HistoryPage | null> {
  try {
    const res = await get(historyUrl(project, id, cursor));
    return res.ok ? ((await res.json()) as HistoryPage) : null;
  } catch {
    return null;
  }
}
