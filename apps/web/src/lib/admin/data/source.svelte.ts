/**
 * The rows of the data page, from the admin feature list API (WP-313). Server-side search, sort, filter and paging
 * only: the table's query goes out as a request, the next page follows its cursor, and nothing is ever loaded as a whole
 * (R14: O(page) per interaction). The latest request wins; an older answer is dropped.
 */
import type { TableQuery, TableRow } from '@ueberblick/ui/components/admin';
import { EMPTY_VALUE, filterLabelOf, shapeRow, type ColumnsInput } from './columns';
import { distinctUrl, listUrl, rowUrl } from './query';

export const SOURCE_ERRORS = ['load', 'more', 'values'] as const;
export type SourceError = (typeof SOURCE_ERRORS)[number];

export interface SourceOptions {
  readonly project: string;
  readonly type: string;
  /** Read at each use, so a changed roster or language is picked up. */
  readonly input: () => ColumnsInput;
  readonly fetch: typeof fetch;
  /** Pause after the last change of the query before it is sent (typing). The first query goes at once. */
  readonly debounceMs?: number;
  readonly onError?: (kind: SourceError) => void;
}

interface Page {
  readonly rows: readonly Record<string, unknown>[];
  readonly next: string | null;
  readonly total: number;
  /** Per reference property: the target ids on this page to their names (A-048). */
  readonly referenceNames?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}
type Distinct = readonly { readonly value: string | number | boolean | null; readonly count: number }[];

/** The input with the names the page brought for its references. */
const withNames = (input: ColumnsInput, page: Page | null): ColumnsInput => ({
  ...input,
  referenceName: (key, id) => page?.referenceNames?.[key]?.[id],
});

export function createFeatureSource(opts: SourceOptions) {
  let rows = $state<TableRow[]>([]);
  let total = $state(0);
  let loading = $state(true); // the table sends its first query on mount
  let loadingMore = $state(false);

  let current: TableQuery = { search: '', sort: null, filters: {}, page: 0 };
  let next: string | null = null;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = false;

  async function get<T>(url: string): Promise<T | null> {
    const res = await opts.fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  }

  async function first(): Promise<void> {
    const mine = ++generation;
    loading = true;
    loadingMore = false;
    try {
      const page = await get<Page>(listUrl(opts.project, opts.type, current, null));
      if (mine !== generation) return;
      if (page === null) return opts.onError?.('load');
      const input = opts.input();
      rows = page.rows.map((r) => shapeRow(r, withNames(input, page)));
      total = page.total;
      next = page.next;
    } catch {
      if (mine === generation) opts.onError?.('load');
    } finally {
      if (mine === generation) loading = false;
    }
  }

  async function more(): Promise<void> {
    if (next === null || loadingMore || loading) return;
    const mine = generation;
    loadingMore = true;
    try {
      const page = await get<Page>(listUrl(opts.project, opts.type, current, next));
      if (mine !== generation) return;
      if (page === null) return opts.onError?.('more');
      const input = opts.input();
      rows = [...rows, ...page.rows.map((r) => shapeRow(r, withNames(input, page)))];
      total = page.total;
      next = page.next;
    } catch {
      if (mine === generation) opts.onError?.('more');
    } finally {
      if (mine === generation) loadingMore = false;
    }
  }

  return {
    get rows(): readonly TableRow[] {
      return rows;
    },
    get total(): number {
      return total;
    },
    get loading(): boolean {
      return loading;
    },
    get loadingMore(): boolean {
      return loadingMore;
    },
    /** The table's query changed: the first one is sent at once, later ones after the typing pauses. */
    query(q: TableQuery): void {
      current = q;
      clearTimeout(timer);
      generation += 1; // answers to the old query are of no use now
      loadingMore = false;
      if (!started) {
        started = true;
        void first();
        return;
      }
      timer = setTimeout(() => void first(), opts.debounceMs ?? 250);
    },
    loadMore: () => void more(),
    /** v3's "Aktualisieren": the first page again under the same query. */
    reload(): void {
      clearTimeout(timer);
      void first();
    },
    /** One row again, in place (after an Admin-Korrektur): the other rows, the scroll and the total stay. */
    async refreshRow(id: string): Promise<void> {
      try {
        const answer = await get<Page>(rowUrl(opts.project, opts.type, id));
        const fresh = answer?.rows[0];
        if (fresh === undefined) return opts.onError?.('load');
        const shaped = shapeRow(fresh, withNames(opts.input(), answer));
        rows = rows.map((r) => (r.id === id ? shaped : r));
      } catch {
        opts.onError?.('load');
      }
    },
    /** The values of one column with counts, under the other filters (the column's filter list). */
    async filterValues(column: string): Promise<{ value: string; label: string; count: number }[]> {
      const label = filterLabelOf(opts.input());
      try {
        const values = await get<Distinct>(distinctUrl(opts.project, opts.type, column, current));
        if (values === null) {
          opts.onError?.('values');
          return [];
        }
        return values.map((v) => {
          const value = v.value === null ? EMPTY_VALUE : String(v.value);
          return { value, label: v.value === null ? '' : label(column, value), count: v.count };
        });
      } catch {
        opts.onError?.('values');
        return [];
      }
    },
    destroy(): void {
      clearTimeout(timer);
      generation += 1;
    },
  };
}

export type FeatureSource = ReturnType<typeof createFeatureSource>;
