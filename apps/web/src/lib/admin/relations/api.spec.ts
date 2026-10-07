// WP-371 (WP-365 follow-up): the holder count of a relation is exact, not the capped sum of `features/distinct`.
import { describe, expect, it, vi } from 'vitest';
import { createRelationsApi } from './api';

function api(totals: { all: number; empty: number } | 'fail') {
  const urls: string[] = [];
  const fetch = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://x');
    urls.push(`${url.pathname}?${url.searchParams}`);
    if (totals === 'fail') return Promise.resolve(new Response('{}', { status: 400 }));
    const empty = url.searchParams.has('filter.baum');
    return Promise.resolve(
      new Response(JSON.stringify({ rows: [], next: null, total: empty ? totals.empty : totals.all })),
    );
  });
  return {
    urls,
    fetch,
    api: createRelationsApi({ project: 'p', language: 'de', fetch: fetch as never, fallback: 'x' }),
  };
}

describe('holding', () => {
  it("is the type's features minus those with no parent, as two one-row list calls", async () => {
    const a = api({ all: 1200, empty: 150 });
    expect(await a.api.holding('kontrolle', 'baum')).toBe(1050);
    expect(a.urls).toHaveLength(2);
    expect(a.urls.every((u) => u.startsWith('/api/admin/p/p/features?') && u.includes('limit=1'))).toBe(true);
    expect(a.urls.some((u) => u.includes('filter.baum=__empty__'))).toBe(true);
  });
  it('counts past 500 (the distinct list capped there)', async () => {
    expect(await api({ all: 100_000, empty: 0 }).api.holding('kontrolle', 'baum')).toBe(100_000);
  });
  it('is 0 when the type is not deployed (the API refuses) or nothing holds it', async () => {
    expect(await api('fail').api.holding('kontrolle', 'baum')).toBe(0);
    expect(await api({ all: 3, empty: 3 }).api.holding('kontrolle', 'baum')).toBe(0);
  });
});
