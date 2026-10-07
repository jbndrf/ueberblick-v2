/**
 * The browser side of the Tabellen pages: one function per write. A table or column edit goes to the page's route
 * (`/admin/projects/<p>/tables`, a draft edit); a row is a run through the admin features API (`$create`, `$lifecycle`;
 * the cell edit is the data page's `$correct`, `data/correct.ts`). Every answer is a `CallResult`: done, or the server's
 * refusal already in the page language, so a component shows a message and never reads a status.
 */
import type { CallResult } from '../participants/types';
import type { ColumnSpec, TableCall } from './types';

type Language = 'de' | 'en';
type Fetch = typeof fetch;

interface Refusal {
  readonly message?: { readonly de?: string; readonly en?: string };
  readonly error?: { readonly message?: string; readonly issues?: readonly { readonly message?: string }[] };
}

export interface TablesApi {
  /** A new table with its first column; the key it got. */
  create(input: {
    name: string;
    key?: string;
    description?: string;
    mainColumn: string;
    roles?: readonly string[];
  }): Promise<CallResult<{ key: string }>>;
  update(
    table: string,
    patch: { name?: string; description?: string; mainColumn?: string; roles?: readonly string[] },
  ): Promise<CallResult<null>>;
  remove(table: string): Promise<CallResult<null>>;
  saveColumns(table: string, columns: readonly ColumnSpec[]): Promise<CallResult<null>>;
  /** One row: a `$create` run; the values are property values (an emptied cell is left out). */
  addRow(table: string, values: Readonly<Record<string, unknown>>): Promise<CallResult<{ id: string }>>;
  /** One row deleted: a `$lifecycle` run. */
  deleteRow(id: string): Promise<CallResult<null>>;
}

export function createTablesApi(opts: {
  readonly project: string;
  readonly language: Language;
  readonly fetch: Fetch;
  /** The message when the server gave none (offline, a 500). */
  readonly fallback: string;
}): TablesApi {
  const project = encodeURIComponent(opts.project);
  const json = { 'content-type': 'application/json' };

  async function send<T>(url: string, body: unknown, read: (answer: unknown) => T): Promise<CallResult<T>> {
    try {
      const res = await opts.fetch(url, { method: 'POST', headers: json, body: JSON.stringify(body) });
      const answer: unknown = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, value: read(answer) };
      const refusal = answer as Refusal;
      const run = refusal.error?.issues?.[0]?.message ?? refusal.error?.message;
      return { ok: false, message: refusal.message?.[opts.language] ?? run ?? opts.fallback };
    } catch {
      return { ok: false, message: opts.fallback };
    }
  }
  const call = <T>(c: TableCall, read: (answer: unknown) => T): Promise<CallResult<T>> =>
    send(`/admin/projects/${project}/tables`, c, read);
  const nothing = (): null => null;

  return {
    create: (input) =>
      call({ action: 'create', ...input }, (a) => ({ key: String((a as { key?: string }).key) })),
    update: (table, patch) => call({ action: 'update', table, ...patch }, nothing),
    remove: (table) => call({ action: 'delete', table }, nothing),
    saveColumns: (table, columns) => call({ action: 'columns', table, columns }, nothing),
    addRow: (table, values) =>
      send(`/api/admin/p/${project}/features`, { type: table, values }, (a) => ({
        id: String((a as { id?: string }).id),
      })),
    deleteRow: (id) =>
      send(
        `/api/admin/p/${project}/features/${encodeURIComponent(id)}/lifecycle`,
        { state: 'deleted' },
        nothing,
      ),
  };
}
