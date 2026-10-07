import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFeatureSource } from './source.svelte';
import type { ColumnsInput } from './columns';
import type { TableQuery } from '@ueberblick/ui/components/admin';

const input: ColumnsInput = {
  type: {
    label: { de: 'Baum' },
    properties: {
      befund: { type: 'text' },
      stage: { type: 'select', options: { a: { de: 'Alpha' } } },
    },
  } as ColumnsInput['type'],
  locale: 'de',
  labels: { status: '', stage: '', createdBy: '', location: '', created: '', yes: 'Ja', no: 'Nein' },
  names: { u1: 'Anna' },
  actors: { system: 'System', importBy: (a) => `Import (${a})` },
};
const empty: TableQuery = { search: '', sort: null, filters: {}, page: 0 };

const row = (n: number) => ({ $id: `f${n}`, $created_by: 'u1', befund: `b${n}`, stage: 'a' });
const page = (from: number, count: number, next: string | null, total = 400) => ({
  rows: Array.from({ length: count }, (_, i) => row(from + i)),
  next,
  total,
});

const at = (calls: Call[], i: number): Call => {
  const c = calls[i];
  if (!c) throw new Error(`no request ${i}`);
  return c;
};

interface Call {
  url: URL;
  resolve: (body: unknown, ok?: boolean) => void;
}
function fakeFetch() {
  const calls: Call[] = [];
  const fetch = vi.fn((url: string) => {
    return new Promise<Response>((resolve) => {
      calls.push({
        url: new URL(url, 'http://x'),
        resolve: (body, ok = true) =>
          resolve({ ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response),
      });
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function make(onError = vi.fn()) {
  const f = fakeFetch();
  const source = createFeatureSource({
    project: 'p',
    type: 'baum',
    input: () => input,
    fetch: f.fetch,
    debounceMs: 250,
    onError,
  });
  return { ...f, source, onError };
}

describe('feature source', () => {
  it('loads the first page at once and shapes the rows', async () => {
    const { source, calls } = make();
    source.query(empty);
    expect(calls).toHaveLength(1);
    expect(source.loading).toBe(true);
    at(calls, 0).resolve(page(0, 2, 'C1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(source.loading).toBe(false);
    expect(source.rows.map((r) => [r.id, r['$created_by'], r['stage']])).toEqual([
      ['f0', 'Anna', ['a']],
      ['f1', 'Anna', ['a']],
    ]);
    expect(source.total).toBe(400);
  });

  it('waits for the typing to pause, then asks the API for the search', async () => {
    const { source, calls } = make();
    source.query(empty);
    at(calls, 0).resolve(page(0, 1, null));
    await vi.advanceTimersByTimeAsync(0);
    source.query({ ...empty, search: 'A' });
    source.query({ ...empty, search: 'Ast' });
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(calls).toHaveLength(2);
    expect(at(calls, 1).url.searchParams.get('q')).toBe('Ast');
  });

  it('keeps the newest answer when an older one comes late', async () => {
    const { source, calls } = make();
    source.query(empty);
    source.query({ ...empty, search: 'x' });
    await vi.advanceTimersByTimeAsync(250);
    at(calls, 1).resolve(page(10, 1, null, 1));
    await vi.advanceTimersByTimeAsync(0);
    at(calls, 0).resolve(page(0, 3, null, 3)); // the first request answers last
    await vi.advanceTimersByTimeAsync(0);
    expect(source.rows.map((r) => r.id)).toEqual(['f10']);
    expect(source.total).toBe(1);
  });

  it('loads the next page by cursor and appends; no cursor means nothing more', async () => {
    const { source, calls } = make();
    source.query({ ...empty, sort: { key: 'befund', direction: 'asc' } });
    at(calls, 0).resolve(page(0, 2, 'C1'));
    await vi.advanceTimersByTimeAsync(0);
    source.loadMore();
    source.loadMore(); // while one is on its way: ignored
    expect(calls).toHaveLength(2);
    expect(source.loadingMore).toBe(true);
    expect(at(calls, 1).url.searchParams.get('cursor')).toBe('C1');
    expect(at(calls, 1).url.searchParams.get('sort')).toBe('befund');
    at(calls, 1).resolve(page(2, 2, null));
    await vi.advanceTimersByTimeAsync(0);
    expect(source.rows.map((r) => r.id)).toEqual(['f0', 'f1', 'f2', 'f3']);
    expect(source.loadingMore).toBe(false);
    source.loadMore();
    expect(calls).toHaveLength(2);
  });

  it('drops a late next page when the query changed meanwhile', async () => {
    const { source, calls } = make();
    source.query(empty);
    at(calls, 0).resolve(page(0, 1, 'C1'));
    await vi.advanceTimersByTimeAsync(0);
    source.loadMore();
    source.query({ ...empty, search: 'q' });
    await vi.advanceTimersByTimeAsync(250);
    at(calls, 2).resolve(page(50, 1, null));
    await vi.advanceTimersByTimeAsync(0);
    at(calls, 1).resolve(page(1, 1, null)); // belongs to the old query
    await vi.advanceTimersByTimeAsync(0);
    expect(source.rows.map((r) => r.id)).toEqual(['f50']);
  });

  it('reload asks again for the first page under the same query', async () => {
    const { source, calls } = make();
    source.query({ ...empty, search: 's' });
    at(calls, 0).resolve(page(0, 1, null));
    await vi.advanceTimersByTimeAsync(0);
    source.reload();
    expect(calls).toHaveLength(2);
    expect(at(calls, 1).url.searchParams.get('q')).toBe('s');
    expect(at(calls, 1).url.searchParams.has('cursor')).toBe(false);
  });

  it('reports a failed load and keeps what is shown', async () => {
    const { source, calls, onError } = make();
    source.query(empty);
    at(calls, 0).resolve(page(0, 1, null));
    await vi.advanceTimersByTimeAsync(0);
    source.reload();
    at(calls, 1).resolve({ error: { code: 'x', message: 'y' } }, false);
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith('load');
    expect(source.rows).toHaveLength(1);
    expect(source.loading).toBe(false);
  });

  it('reads one row again in place after a correction (WP-370), leaving the others and the scroll alone', async () => {
    const { source, calls } = make();
    source.query(empty);
    at(calls, 0).resolve(page(0, 3, 'C1'));
    await vi.advanceTimersByTimeAsync(0);
    const done = source.refreshRow('f1');
    expect(at(calls, 1).url.searchParams.get('filter.$id')).toBe('f1');
    at(calls, 1).resolve({ rows: [{ ...row(1), befund: 'neu' }], next: null, total: 1 });
    await done;
    expect(source.rows.map((r) => [r.id, r['befund']])).toEqual([
      ['f0', 'b0'],
      ['f1', 'neu'],
      ['f2', 'b2'],
    ]);
    expect(source.total).toBe(400);
  });

  it('answers a filter list with raw values, labels and counts', async () => {
    const { source, calls } = make();
    source.query({ ...empty, filters: { befund: ['x'] } });
    at(calls, 0).resolve(page(0, 0, null, 0));
    await vi.advanceTimersByTimeAsync(0);
    const values = source.filterValues('stage');
    expect(at(calls, 1).url.pathname).toBe('/api/admin/p/p/features/distinct');
    expect(at(calls, 1).url.searchParams.get('column')).toBe('stage');
    expect(at(calls, 1).url.searchParams.get('filter.befund')).toBe('x');
    at(calls, 1).resolve([
      { value: 'a', count: 3 },
      { value: null, count: 2 },
      { value: true, count: 1 },
    ]);
    expect(await values).toEqual([
      { value: 'a', label: 'Alpha', count: 3 },
      { value: '__empty__', label: '', count: 2 },
      { value: 'true', label: 'true', count: 1 },
    ]);
  });
});
