import { describe, expect, it, vi } from 'vitest';
import { createParticipantsApi } from './api';

type Call = { url: string; init?: RequestInit };

function setup(answer: { status?: number; body?: unknown } | 'offline', language: 'de' | 'en' = 'de') {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init ? { init } : {}) });
    if (answer === 'offline') throw new TypeError('offline');
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  const api = createParticipantsApi({ project: 'muster stadt', language, fetch, fallback: 'FALLBACK' });
  return { api, calls };
}
const bodyOf = (c: Call | undefined): unknown => JSON.parse(String(c?.init?.body));

describe('writes go to the WP-310 and WP-607 routes', () => {
  it('add: POST participants with name, roles and attrs', async () => {
    const { api, calls } = setup({ status: 201, body: { id: 'anna-1' } });
    const r = await api.add({ name: 'Anna', roles: ['kontrolle'], attrs: { personalnummer: '1' } });
    expect(r).toEqual({ ok: true, value: { id: 'anna-1' } });
    expect(calls[0]?.url).toBe('/api/admin/p/muster%20stadt/participants');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(bodyOf(calls[0])).toEqual({ name: 'Anna', roles: ['kontrolle'], attrs: { personalnummer: '1' } });
  });

  it('patch, remove', async () => {
    const { api, calls } = setup({});
    await api.patch('a/b', { disabled: true });
    await api.remove('a/b');
    expect(calls.map((c) => [c.init?.method, c.url])).toEqual([
      ['PATCH', '/api/admin/p/muster%20stadt/participants/a%2Fb'],
      ['DELETE', '/api/admin/p/muster%20stadt/participants/a%2Fb'],
    ]);
    expect(bodyOf(calls[0])).toEqual({ disabled: true });
  });

  it('token: PUT with a chosen token, PUT without one to generate, DELETE to revoke', async () => {
    const { api, calls } = setup({ body: { token: 'AAAA-BBBB', link: '/login?token=AAAA-BBBB' } });
    expect(await api.setToken('p1', 'AAAA-BBBB')).toEqual({ ok: true, value: { token: 'AAAA-BBBB' } });
    await api.setToken('p1');
    await api.revokeToken('p1');
    expect(calls.map((c) => c.init?.method)).toEqual(['PUT', 'PUT', 'DELETE']);
    expect(calls[0]?.url).toBe('/api/admin/p/muster%20stadt/participants/p1/credentials');
    expect(bodyOf(calls[0])).toEqual({ token: 'AAAA-BBBB' });
    expect(bodyOf(calls[1])).toEqual({});
  });

  it('columns: PUT the whole list', async () => {
    const { api, calls } = setup({});
    await api.saveColumns([{ key: 'pn', label: 'PN', type: 'text', required: true }]);
    expect(calls[0]?.url).toBe('/api/admin/p/muster%20stadt/participants/columns');
    expect(bodyOf(calls[0])).toEqual({ columns: [{ key: 'pn', label: 'PN', type: 'text', required: true }] });
  });

  it('a role typed in the cell goes to the page route and comes back as the new option', async () => {
    const { api, calls } = setup({
      status: 201,
      body: { role: { key: 'praktikum', label: 'Praktikum', pending: true } },
    });
    expect(await api.createRole('Praktikum')).toEqual({
      ok: true,
      value: { key: 'praktikum', label: 'Praktikum', pending: true },
    });
    expect(calls[0]?.url).toBe('/admin/projects/muster%20stadt/participants/roles');
  });
});

describe('refusals', () => {
  const refusal = {
    status: 400,
    body: { error: 'name_required', message: { en: 'Name is required', de: 'Name ist erforderlich' } },
  };

  it('arrive in the page language (v3: "Name ist erforderlich")', async () => {
    expect(await setup(refusal, 'de').api.add({ name: '', roles: [] })).toEqual({
      ok: false,
      message: 'Name ist erforderlich',
    });
    expect(await setup(refusal, 'en').api.add({ name: '', roles: [] })).toEqual({
      ok: false,
      message: 'Name is required',
    });
  });

  it('use the fallback when the server gave no message, or the network is gone', async () => {
    expect(await setup({ status: 500 }).api.remove('x')).toEqual({ ok: false, message: 'FALLBACK' });
    expect(await setup('offline').api.remove('x')).toEqual({ ok: false, message: 'FALLBACK' });
  });
});
