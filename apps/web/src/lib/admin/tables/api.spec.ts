// WP-382: the browser side: a row is one run through the features API, a table or column edit is one draft call.
import { describe, expect, it, vi } from 'vitest';
import { createTablesApi } from './api';

function api(answer: { status: number; body: unknown } | 'offline', language: 'de' | 'en' = 'de') {
  const fetch = vi.fn(async () => {
    if (answer === 'offline') throw new Error('offline');
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
  return { fetch, api: createTablesApi({ project: 'demo', language, fetch, fallback: 'Fehler' }) };
}
const sent = (fetch: ReturnType<typeof api>['fetch'], n = 0) => {
  const [url, init] = fetch.mock.calls[n] as unknown as [string, RequestInit];
  return { url, method: init.method, body: JSON.parse(String(init.body)) as unknown };
};

describe('tables api', () => {
  it('adding a row is one POST features with the type and the values', async () => {
    const t = api({ status: 201, body: { runId: 'r', id: 'f1' } });
    expect(await t.api.addRow('geraete', { name: 'Bagger' })).toEqual({ ok: true, value: { id: 'f1' } });
    expect(t.fetch).toHaveBeenCalledTimes(1);
    expect(sent(t.fetch)).toEqual({
      url: '/api/admin/p/demo/features',
      method: 'POST',
      body: { type: 'geraete', values: { name: 'Bagger' } },
    });
  });

  it('deleting a row is one lifecycle run with the state deleted', async () => {
    const t = api({ status: 200, body: { runId: 'r' } });
    expect(await t.api.deleteRow('f 1')).toEqual({ ok: true, value: null });
    expect(sent(t.fetch)).toEqual({
      url: '/api/admin/p/demo/features/f%201/lifecycle',
      method: 'POST',
      body: { state: 'deleted' },
    });
  });

  it('a column save sends the whole list to the page route', async () => {
    const t = api({ status: 200, body: {} });
    const columns = [{ key: 'name', label: 'Name', type: 'text', required: true }];
    expect(await t.api.saveColumns('geraete', columns)).toEqual({ ok: true, value: null });
    expect(sent(t.fetch)).toEqual({
      url: '/admin/projects/demo/tables',
      method: 'POST',
      body: { action: 'columns', table: 'geraete', columns },
    });
  });

  it('creating a table returns its key', async () => {
    const t = api({ status: 201, body: { key: 'geraete' } });
    expect(await t.api.create({ name: 'Geräte', mainColumn: 'Name' })).toEqual({
      ok: true,
      value: { key: 'geraete' },
    });
    expect(sent(t.fetch).body).toEqual({ action: 'create', name: 'Geräte', mainColumn: 'Name' });
  });

  it('a refusal comes back in the page language; a run refusal gives the issue; offline gives the fallback', async () => {
    const draft = {
      status: 400,
      body: { error: 'bad_key', message: { de: 'Schlüssel falsch', en: 'bad key' } },
    };
    expect(await api(draft, 'en').api.update('x', { name: 'y' })).toEqual({ ok: false, message: 'bad key' });
    const run = {
      status: 422,
      body: { error: { code: 'run_refused', message: 'm', issues: [{ message: 'Pflicht' }] } },
    };
    expect(await api(run).api.addRow('x', {})).toEqual({ ok: false, message: 'Pflicht' });
    expect(await api('offline').api.remove('x')).toEqual({ ok: false, message: 'Fehler' });
  });
});
