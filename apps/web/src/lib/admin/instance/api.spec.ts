import { describe, expect, it, vi } from 'vitest';
import { createInstanceApi } from './api';
import type { PageValues } from './model';

const messages = { slugTaken: 'TAKEN', slugInvalid: 'INVALID' };
const page: PageValues = {
  title: ' Impressum ',
  slug: 'impressum',
  body: '<p>x</p>',
  sortOrder: 2,
  showInConsentFooter: true,
};

function make(status = 200) {
  const fetch = vi.fn(async (...args: [string | URL | Request, RequestInit?]) => {
    void args;
    return new Response('{}', { status });
  });
  const api = createInstanceApi({
    fetch: fetch as unknown as typeof globalThis.fetch,
    messages,
  });
  const calls = () => fetch.mock.calls.map(([u, i]) => `${i?.method} ${String(u)}`);
  return { api, fetch, calls };
}

describe('instance api', () => {
  it('saveSettings PUTs the settings as the API takes them', async () => {
    const { api, fetch } = make();
    const s = {
      requireConsent: true,
      consentTitle: 'T',
      consentBody: 'B',
      acceptLabel: 'A',
      rejectLabel: 'R',
    };
    expect(await api.saveSettings(s)).toEqual({ ok: true });
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/instance/settings');
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(s);
  });

  it('createPage is a create-only PUT under the slug with a trimmed title', async () => {
    const { api, fetch, calls } = make();
    expect(await api.createPage(page)).toEqual({ ok: true });
    expect(calls()).toEqual(['PUT /api/instance/legal/impressum?create=1']);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      title: 'Impressum',
      body: '<p>x</p>',
      sortOrder: 2,
      showInConsentFooter: true,
    });
  });

  it('createPage on a taken slug (409) is the slug-taken message', async () => {
    const { api } = make(409);
    expect(await api.createPage(page)).toEqual({ ok: false, refused: true, message: 'TAKEN' });
  });

  it('createPage refuses an invalid slug or an empty title, without a call', async () => {
    const { api, calls } = make();
    expect(await api.createPage({ ...page, slug: 'Bad Slug' })).toEqual({
      ok: false,
      refused: true,
      message: 'INVALID',
    });
    expect(await api.createPage({ ...page, slug: 'ok', title: ' ' })).toEqual({
      ok: false,
      refused: true,
      message: 'INVALID',
    });
    expect(calls()).toEqual([]);
  });

  it('updatePage with the same slug is one PUT', async () => {
    const { api, calls } = make();
    expect(await api.updatePage('impressum', page)).toEqual({ ok: true });
    expect(calls()).toEqual(['PUT /api/instance/legal/impressum']);
  });

  it('updatePage with a new slug is one atomic PATCH on the old slug', async () => {
    const { api, calls, fetch } = make();
    expect(await api.updatePage('alt', page)).toEqual({ ok: true });
    expect(calls()).toEqual(['PATCH /api/instance/legal/alt']);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      slug: 'impressum',
      title: 'Impressum',
    });
  });

  it('a rename onto an existing slug (409) is the slug-taken message', async () => {
    const { api } = make(409);
    expect(await api.updatePage('alt', page)).toEqual({ ok: false, refused: true, message: 'TAKEN' });
  });

  it('deletePage DELETEs; a refused or failed call is the page-language message', async () => {
    const ok = make();
    expect(await ok.api.deletePage('impressum')).toEqual({ ok: true });
    expect(ok.calls()).toEqual(['DELETE /api/instance/legal/impressum']);
    const bad = make(403);
    expect(await bad.api.deletePage('impressum')).toEqual({ ok: false, refused: false });
    const down = createInstanceApi({
      fetch: (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch,
      messages,
    });
    expect(
      await down.saveSettings({
        requireConsent: false,
        consentTitle: '',
        consentBody: '',
        acceptLabel: 'a',
        rejectLabel: 'r',
      }),
    ).toEqual({ ok: false, refused: false });
  });
});
