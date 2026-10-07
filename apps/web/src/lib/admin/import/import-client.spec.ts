import { describe, expect, it } from 'vitest';
import { createImportClient } from './import-client';
import type { MappingBody } from './mapping';

const mapping: MappingBody = { task: 'erfassen', fields: { art: 'Art' }, delimiter: ',' };
const file = new File(['Art\nEiche'], 'baeume.csv', { type: 'text/csv' });
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function client(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof globalThis.fetch;
  return { calls, api: createImportClient({ project: 'muster', fetch, sleep: async () => undefined }) };
}
const form = (c: { init: RequestInit | undefined } | undefined): FormData => c?.init?.body as FormData;

describe('plan: the dry run', () => {
  it('posts the file and the mapping and returns counts, problems and the preview', async () => {
    const body = {
      counts: { valid: 4, problem_rows: 1, problems: 1 },
      problems: [{ row: 3, code: 'geometry_invalid', message: 'x' }],
      preview: [{ row: 1, values: { art: 'Eiche' } }],
    };
    const { api, calls } = client(() => reply(200, body));
    expect(await api.plan(file, mapping)).toEqual({ kind: 'ok', ...body });
    expect(calls[0]?.url).toBe('/api/admin/p/muster/import/plan');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(form(calls[0]).get('file')).toBeInstanceOf(File);
    expect(JSON.parse(String(form(calls[0]).get('mapping')))).toEqual(mapping);
  });

  it('a refusal comes back with its code (not_published, invalid_import, ...)', async () => {
    const { api } = client(() => reply(409, { error: { code: 'not_published', message: 'no' } }));
    expect(await api.plan(file, mapping)).toEqual({ kind: 'error', code: 'not_published', message: 'no' });
  });

  it('a network failure is an error, not a throw', async () => {
    const { api } = client(() => {
      throw new Error('offline');
    });
    expect(await api.plan(file, mapping)).toMatchObject({ kind: 'error', code: 'network' });
  });
});

describe('start and watch: the import job', () => {
  it('starts with mode and replace, then polls the job until it is done', async () => {
    const states = [
      { state: 'queued', rows_done: 0, rows_total: 0 },
      { state: 'running', rows_done: 100, rows_total: 250 },
      { state: 'done', rows_done: 250, rows_total: 250, imported: 250, outcome: 'accepted', problems: [] },
    ];
    let n = 0;
    const { api, calls } = client((url) =>
      url.endsWith('/import') ? reply(202, { job: 'j1' }) : reply(200, { job: states[n++] }),
    );
    const seen: number[] = [];
    const out = await api.run(file, mapping, { mode: 'skip', replace: false }, (p) => seen.push(p.rows_done));
    expect(out).toMatchObject({ kind: 'done', job: { outcome: 'accepted', imported: 250 } });
    expect(seen).toEqual([0, 100, 250]);
    expect(calls[0]?.url).toBe('/api/admin/p/muster/import');
    expect(form(calls[0]).get('mode')).toBe('skip');
    expect(form(calls[0]).get('replace')).toBe('false');
    expect(calls[1]?.url).toBe('/api/admin/p/muster/import/j1');
  });

  it('a failed job is reported with its error', async () => {
    const { api } = client((url) =>
      url.endsWith('/import')
        ? reply(202, { job: 'j1' })
        : reply(200, { job: { state: 'failed', error: 'restart', rows_done: 0, rows_total: 0 } }),
    );
    expect(await api.run(file, mapping, { mode: 'atomic', replace: true }, () => undefined)).toMatchObject({
      kind: 'done',
      job: { state: 'failed', error: 'restart' },
    });
  });

  it('a start that is refused ends the run with the code (replace_needs_atomic)', async () => {
    const { api } = client(() => reply(422, { error: { code: 'replace_needs_atomic', message: 'm' } }));
    expect(await api.run(file, mapping, { mode: 'skip', replace: true }, () => undefined)).toEqual({
      kind: 'error',
      code: 'replace_needs_atomic',
      message: 'm',
    });
  });

  it('gives up after three failed polls in a row', async () => {
    const { api } = client((url) => {
      if (url.endsWith('/import')) return reply(202, { job: 'j1' });
      throw new Error('offline');
    });
    expect(await api.run(file, mapping, { mode: 'skip', replace: false }, () => undefined)).toMatchObject({
      kind: 'error',
      code: 'network',
    });
  });
});
