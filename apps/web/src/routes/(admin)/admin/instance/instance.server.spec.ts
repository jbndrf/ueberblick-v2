import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  instanceHandlersFor,
  instanceStoreFor,
  type InstanceHandlers,
  type Principal,
} from '@ueberblick/server';
import type * as Page from './+page.server';

// WP-447: the page's load and the writes it makes, over the REAL runtime and the handlers the route files delegate to: the settings
// saved by `PUT /api/instance/settings` come back in the load, pages appear in order on `/legal` and in the consent
// footer, and a non-admin is sent to the sign-in.
const dir = mkdtempSync(join(tmpdir(), 'ub-admin-instance-'));
let page: typeof Page;
let handlers: InstanceHandlers;
let resetInstance: () => void = () => undefined;
let stop: () => void = () => undefined;
let admin: Principal;
let cookie = '';

const call = (
  handler: (req: Request, ctx: { params: { slug: string } }) => Promise<Response>,
  method: string,
  url: string,
  slug: string,
  body?: unknown,
) => {
  const request = new Request(`http://localhost${url}`, {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return handler(request, { params: { slug } });
};
const loadEvent = (principal: Principal | null) =>
  ({
    url: new URL('http://localhost/admin/instance'),
    locals: { admin: principal },
    cookies: { get: () => undefined },
    request: new Request('http://localhost/admin/instance'),
  }) as unknown as Parameters<(typeof Page)['load']>[0];

beforeAll(async () => {
  process.env['PUBLIC_URL'] = 'http://localhost:3000';
  process.env['PACK_BUILD'] = '0';
  process.env['DATA_DIR'] = dir;
  process.env['TIMERS_INTERVAL_S'] = '0';
  const { runtime } = await import('../../../../lib/server/runtime');
  page = await import('./+page.server');
  const rt = runtime();
  handlers = instanceHandlersFor(rt);
  const store = instanceStoreFor(rt);
  // Every test starts from a new instance: consent off, no pages (a repeat in the same process must too).
  resetInstance = () => {
    store.saveSettings({
      requireConsent: false,
      consentTitle: '',
      consentBody: '',
      acceptLabel: '',
      rejectLabel: '',
    });
    for (const p of store.pages()) store.removePage(p.slug);
  };
  stop = () => rt.stop();
  const id = await rt.auth.createAdmin('admin@example.org', 'correct horse battery');
  admin = { kind: 'admin', id, projectId: null, roles: [] };
  cookie = `ub_session_admin=${rt.auth.openAdminSession(id).id}`;
}, 30_000);

afterEach(() => resetInstance());

afterAll(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('load', () => {
  it('a signed-out visitor or a participant goes to the sign-in (303)', () => {
    for (const p of [null, { kind: 'participant', id: 'x', projectId: 'p', roles: [] } as Principal]) {
      try {
        page.load(loadEvent(p));
        expect.unreachable();
      } catch (e) {
        expect((e as { status: number }).status).toBe(303);
      }
    }
  });

  it('an admin gets the defaults of a new instance: consent off, no pages', async () => {
    const data = (await page.load(loadEvent(admin))) as {
      settings: { requireConsent: boolean };
      pages: unknown[];
    };
    expect(data.settings.requireConsent).toBe(false);
    expect(data.pages).toEqual([]);
  });
});

describe('the writes the page makes', () => {
  it('turns consent on and edits the banner; the load and the consent endpoint show it', async () => {
    const put = await call(handlers.settingsPut, 'PUT', '/api/instance/settings', '', {
      requireConsent: true,
      consentTitle: 'Datenschutz',
      consentBody: '<p>Hallo</p>',
      acceptLabel: 'Ok',
      rejectLabel: 'Nein',
    });
    expect(put.status).toBe(200);
    const data = (await page.load(loadEvent(admin))) as { settings: Record<string, unknown> };
    expect(data.settings).toMatchObject({
      requireConsent: true,
      consentTitle: 'Datenschutz',
      acceptLabel: 'Ok',
    });
    const consent = (await call(handlers.consent, 'GET', '/api/instance/consent', '').then((r) =>
      r.json(),
    )) as { required: boolean; title: string };
    expect(consent).toMatchObject({ required: true, title: 'Datenschutz' });
  });

  it('pages: order and "Im Consent-Footer anzeigen" show on /legal and in the consent footer; delete removes', async () => {
    const body = (title: string, sortOrder: number, showInConsentFooter: boolean) => ({
      title,
      body: `<h1>${title}</h1>`,
      sortOrder,
      showInConsentFooter,
    });
    const put = (slug: string, b: unknown) =>
      call(handlers.pagePut, 'PUT', `/api/instance/legal/${slug}`, slug, b);
    expect((await put('zweite', body('Zweite', 5, false))).status).toBe(200);
    expect((await put('erste', body('Erste', 1, true))).status).toBe(200);

    // `/legal` and `GET /api/instance/legal` list the same store pages in the same order.
    const listed = (await call(handlers.legalList, 'GET', '/api/instance/legal', '').then((r) =>
      r.json(),
    )) as {
      pages: { slug: string }[];
    };
    expect(listed.pages.map((p) => p.slug)).toEqual(['erste', 'zweite']);

    const consent = (await call(handlers.consent, 'GET', '/api/instance/consent', '').then((r) =>
      r.json(),
    )) as { footerPages: { slug: string }[] };
    expect(consent.footerPages.map((p) => p.slug)).toEqual(['erste']);

    // a slug outside the alphabet is refused by the API
    expect((await put('Bad_Slug', body('x', 0, false))).status).toBe(400);

    // a rename is a write under the new slug and a delete of the old one
    expect((await put('dritte', body('Zweite', 5, false))).status).toBe(200);
    const del = await call(handlers.pageDelete, 'DELETE', '/api/instance/legal/zweite', 'zweite');
    expect(del.status).toBe(204);
    const data = (await page.load(loadEvent(admin))) as { pages: { slug: string }[] };
    expect(data.pages.map((p) => p.slug)).toEqual(['erste', 'dritte']);
  });
});
