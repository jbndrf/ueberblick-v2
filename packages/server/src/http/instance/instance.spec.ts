import { describe, expect, it } from 'vitest';
import type { Key } from '@ueberblick/core';
import { createAuth, isAuthError } from '../../auth';
import { openControlDb } from '../../db/open';
import { createInstanceStore } from '../../instance';
import { HTTP_ERRORS } from '../shared/registry';
import { createInstanceHandlers } from './handlers';

const NOW = '2026-10-01T08:00:00.000Z';

async function world() {
  const control = openControlDb(':memory:');
  control
    .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
    .run('p1', 't', 't', 'x');
  const auth = createAuth({ control, now: () => new Date(NOW), participantRoles: () => ['melder' as Key] });
  const s = auth.exchange(auth.issueCredential('p1', 'mia').token);
  if (isAuthError(s)) throw new Error(s.code);
  const adminId = await auth.createAdmin('a@example.org', 'correct horse battery');
  const cookies = {
    participant: `ub_session_participant=${s.id}`,
    admin: `ub_session_admin=${auth.openAdminSession(adminId).id}`,
  };
  const store = createInstanceStore(control, { now: () => NOW });
  const h = createInstanceHandlers({ auth, store, secureCookies: false });
  const call = (
    handler: keyof typeof h,
    o: { method?: string; cookie?: string; body?: unknown; slug?: string; query?: string } = {},
  ) =>
    h[handler](
      new Request(`http://x/api/instance/x${o.query ?? ''}`, {
        method: o.method ?? 'GET',
        headers: { ...(o.cookie ? { cookie: o.cookie } : {}), 'content-type': 'application/json' },
        ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
      }),
      { params: { slug: o.slug ?? '' } },
    );
  return { call, cookies, store };
}

const settings = {
  requireConsent: true,
  consentTitle: 'Datenschutz',
  consentBody: '<p>Text</p>',
  acceptLabel: '',
  rejectLabel: '',
};
const pageBody = { title: 'Impressum', body: '<p>Betreiber</p>', sortOrder: 1, showInConsentFooter: true };

describe('public reads', () => {
  it('consent: off by default, then on with footer pages, and "accepted" follows the cookie', async () => {
    const w = await world();
    expect(await (await w.call('consent')).json()).toMatchObject({ required: false, accepted: false });
    w.store.saveSettings(settings);
    w.store.savePage({ slug: 'impressum', ...pageBody });
    w.store.savePage({ slug: 'intern', ...pageBody, title: 'Intern', showInConsentFooter: false });
    const body = (await (await w.call('consent')).json()) as { footerPages: unknown };
    expect(body).toMatchObject({ required: true, accepted: false, title: 'Datenschutz' });
    expect(body.footerPages).toEqual([{ slug: 'impressum', title: 'Impressum', body: '<p>Betreiber</p>' }]);
    const cookie = 'consent=accepted';
    expect(await (await w.call('consent', { cookie })).json()).toMatchObject({ accepted: true });
  });

  it('legal: lists pages (slug, title) without a session; one page by slug; 404 for an unknown or bad slug', async () => {
    const w = await world();
    w.store.savePage({ slug: 'impressum', ...pageBody });
    const list = await w.call('legalList');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ pages: [{ slug: 'impressum', title: 'Impressum' }] });
    const one = await (await w.call('legalPage', { slug: 'impressum' })).json();
    expect(one).toMatchObject({ page: { slug: 'impressum', title: 'Impressum', body: '<p>Betreiber</p>' } });
    expect((await w.call('legalPage', { slug: 'nope' })).status).toBe(404);
    expect((await w.call('legalPage', { slug: '../x' })).status).toBe(404);
  });
});

describe('deciding', () => {
  it('accept sets the one-year cookie; reject sets it too, but as rejected; anything else is 400', async () => {
    const w = await world();
    const a = await w.call('decide', { method: 'POST', body: { decision: 'accepted' } });
    expect(a.status).toBe(200);
    expect(a.headers.get('set-cookie')).toMatch(/^consent=accepted;.*Max-Age=31536000/);
    const r = await w.call('decide', { method: 'POST', body: { decision: 'rejected' } });
    expect(r.headers.get('set-cookie')).toMatch(/^consent=rejected/);
    expect((await w.call('decide', { method: 'POST', body: { decision: 'maybe' } })).status).toBe(400);
  });
});

describe('write API (admin only)', () => {
  it('refuses anonymous and a participant-only browser with 401 (the admin API reads the admin cookie only, WP-705)', async () => {
    const w = await world();
    for (const [handler, method, body] of [
      ['settingsGet', 'GET', undefined],
      ['settingsPut', 'PUT', settings],
      ['pagePut', 'PUT', pageBody],
      ['pageRename', 'PATCH', { ...pageBody, slug: 'neu' }],
      ['pageDelete', 'DELETE', undefined],
    ] as const) {
      expect((await w.call(handler, { method, body, slug: 'impressum' })).status).toBe(401);
      const r = await w.call(handler, { method, body, slug: 'impressum', cookie: w.cookies.participant });
      expect(r.status).toBe(401);
    }
  });

  it('an admin saves the settings, creates, lists with bodies, replaces and deletes a page', async () => {
    const w = await world();
    const cookie = w.cookies.admin;
    expect((await w.call('settingsPut', { method: 'PUT', cookie, body: settings })).status).toBe(200);
    expect(w.store.settings().requireConsent).toBe(true);
    const put = await w.call('pagePut', { method: 'PUT', cookie, slug: 'impressum', body: pageBody });
    expect(put.status).toBe(200);
    const all = (await (await w.call('settingsGet', { cookie })).json()) as {
      settings: unknown;
      pages: unknown;
    };
    expect(all.settings).toEqual(settings);
    expect(all.pages).toMatchObject([
      { slug: 'impressum', body: '<p>Betreiber</p>', showInConsentFooter: true },
    ]);
    await w.call('pagePut', {
      method: 'PUT',
      cookie,
      slug: 'impressum',
      body: { ...pageBody, title: 'Neu' },
    });
    expect(w.store.page('impressum')?.title).toBe('Neu');
    expect((await w.call('pageDelete', { method: 'DELETE', cookie, slug: 'impressum' })).status).toBe(204);
    expect((await w.call('pageDelete', { method: 'DELETE', cookie, slug: 'impressum' })).status).toBe(404);
  });

  it('refuses a bad body or slug with 400', async () => {
    const w = await world();
    const cookie = w.cookies.admin;
    expect(
      (await w.call('settingsPut', { method: 'PUT', cookie, body: { requireConsent: 'yes' } })).status,
    ).toBe(400);
    expect(
      (await w.call('pagePut', { method: 'PUT', cookie, slug: 'Bad Slug', body: pageBody })).status,
    ).toBe(400);
    expect((await w.call('pagePut', { method: 'PUT', cookie, slug: 'ok', body: { title: '' } })).status).toBe(
      400,
    );
  });
});

describe('create-only PUT and atomic rename', () => {
  it('PUT ?create=1 answers 201, then 409 slug_taken without overwriting', async () => {
    const w = await world();
    const cookie = w.cookies.admin;
    const create = { method: 'PUT', cookie, slug: 'impressum', query: '?create=1' };
    expect((await w.call('pagePut', { ...create, body: pageBody })).status).toBe(201);
    const again = await w.call('pagePut', { ...create, body: { ...pageBody, title: 'Anders' } });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('slug_taken');
    expect(HTTP_ERRORS.get('slug_taken').status).toBe(409);
    expect(w.store.page('impressum')?.title).toBe('Impressum');
  });

  it('PATCH moves a page with its new values; 409 onto another page, 404 when missing, 400 on a bad slug', async () => {
    const w = await world();
    const cookie = w.cookies.admin;
    w.store.savePage({ slug: 'alt', ...pageBody });
    w.store.savePage({ slug: 'belegt', ...pageBody });
    const patch = (slug: string, to: string) =>
      w.call('pageRename', { method: 'PATCH', cookie, slug, body: { ...pageBody, title: 'Neu', slug: to } });
    expect((await patch('alt', 'belegt')).status).toBe(409);
    expect((await patch('weg', 'x')).status).toBe(404);
    expect((await patch('alt', 'Bad Slug')).status).toBe(400);
    expect((await patch('alt', 'neu')).status).toBe(200);
    expect(w.store.page('alt')).toBeUndefined();
    expect(w.store.page('neu')?.title).toBe('Neu');
  });
});
