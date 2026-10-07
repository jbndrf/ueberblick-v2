/**
 * Instance-level endpoints (WP-638, gap G5): the consent gate and the legal pages.
 *
 * Public: `GET /api/instance/consent` (what the sign-in modal shows and whether this browser accepted),
 * `POST /api/instance/consent {decision}` (sets the one-year `consent` cookie), `GET /api/instance/legal` and
 * `GET /api/instance/legal/<slug>`.
 * Admin only (any admin account; the instance has no per-project scope): `GET | PUT /api/instance/settings`,
 * `PUT | PATCH | DELETE /api/instance/legal/<slug>`: `PUT ?create=1` answers 409 `slug_taken` instead of
 * overwriting; `PATCH` (body: the page values plus the new `slug`) moves and saves the page in one step (409 when
 * the new slug is another page). The editing UI is the instance-settings page (lead-a).
 */
import { z } from '@ueberblick/core/zod';
import { readSessionCookie, type Auth } from '../../auth';
import {
  CONSENT_DECISIONS,
  LEGAL_SLUG,
  consentCookie,
  readConsent,
  type InstanceStore,
} from '../../instance';
import { readBody } from '../shared/body';
import type { Handler } from '../shared/contract';
import { errorResponse, jsonResponse } from '../shared/errors';

export interface InstanceDeps {
  readonly auth: Pick<Auth, 'authenticate'>;
  readonly store: InstanceStore;
  readonly secureCookies: boolean;
}

type Params = { readonly slug: string };
export interface InstanceHandlers {
  readonly consent: Handler<Params>;
  readonly decide: Handler<Params>;
  readonly legalList: Handler<Params>;
  readonly legalPage: Handler<Params>;
  readonly settingsGet: Handler<Params>;
  readonly settingsPut: Handler<Params>;
  readonly pagePut: Handler<Params>;
  readonly pageRename: Handler<Params>;
  readonly pageDelete: Handler<Params>;
}

const MAX_BODY_BYTES = 512 * 1024;
const Settings = z.strictObject({
  requireConsent: z.boolean(),
  consentTitle: z.string().max(255),
  consentBody: z.string().max(100_000),
  acceptLabel: z.string().max(100),
  rejectLabel: z.string().max(100),
});
const PageBody = z.strictObject({
  title: z.string().min(1).max(255),
  body: z.string().max(200_000),
  sortOrder: z.number().int().min(0).max(100_000),
  showInConsentFooter: z.boolean(),
});
const RenameBody = PageBody.extend({ slug: z.string() });
const Decision = z.strictObject({
  decision: z.string().refine((d) => CONSENT_DECISIONS.has(d), 'not a decision'),
});

export function createInstanceHandlers(deps: InstanceDeps): InstanceHandlers {
  const { store } = deps;
  const adminOnly = (req: Request): Response | null => {
    const principal = deps.auth.authenticate(readSessionCookie(req, 'admin'));
    if (principal === null) return errorResponse('unauthenticated', 'Sign in first.');
    if (principal.kind !== 'admin') return errorResponse('forbidden', 'Admin access required.');
    return null;
  };
  const taken = (): Response => errorResponse('slug_taken', 'A legal page with this slug exists.');
  const notFound = (): Response => errorResponse('not_found', 'No such legal page.');

  return {
    consent: async (req) => {
      const s = store.settings();
      return jsonResponse({
        required: s.requireConsent,
        accepted: readConsent(req) === 'accepted',
        title: s.consentTitle,
        body: s.consentBody,
        acceptLabel: s.acceptLabel,
        rejectLabel: s.rejectLabel,
        footerPages: store.footerPages().map((p) => ({ slug: p.slug, title: p.title, body: p.body })),
      });
    },
    decide: async (req) => {
      const body = await readBody(req, Decision, 1024);
      if (body instanceof Response) return body;
      const res = jsonResponse({ ok: true });
      res.headers.set(
        'set-cookie',
        consentCookie(body.decision as 'accepted' | 'rejected', { secure: deps.secureCookies }),
      );
      return res;
    },
    legalList: async () =>
      jsonResponse({ pages: store.pages().map((p) => ({ slug: p.slug, title: p.title })) }),
    legalPage: async (_req, ctx) => {
      const p = LEGAL_SLUG.test(ctx.params.slug) ? store.page(ctx.params.slug) : undefined;
      if (p === undefined) return notFound();
      return jsonResponse({
        page: { slug: p.slug, title: p.title, body: p.body, updatedAt: p.updatedAt },
      });
    },
    settingsGet: async (req) =>
      adminOnly(req) ?? jsonResponse({ settings: store.settings(), pages: store.pages() }),
    settingsPut: async (req) => {
      const denied = adminOnly(req);
      if (denied) return denied;
      const body = await readBody(req, Settings, MAX_BODY_BYTES);
      if (body instanceof Response) return body;
      store.saveSettings(body);
      return jsonResponse({ settings: store.settings() });
    },
    pagePut: async (req, ctx) => {
      const denied = adminOnly(req);
      if (denied) return denied;
      if (!LEGAL_SLUG.test(ctx.params.slug))
        return errorResponse('invalid_body', 'The slug is 1 to 100 of a-z, 0-9 and "-".');
      const body = await readBody(req, PageBody, MAX_BODY_BYTES);
      if (body instanceof Response) return body;
      if (new URL(req.url).searchParams.get('create') === '1') {
        const created = store.createPage({ slug: ctx.params.slug, ...body });
        return created === undefined ? taken() : jsonResponse({ page: created }, 201);
      }
      return jsonResponse({ page: store.savePage({ slug: ctx.params.slug, ...body }) });
    },
    pageRename: async (req, ctx) => {
      const denied = adminOnly(req);
      if (denied) return denied;
      const body = await readBody(req, RenameBody, MAX_BODY_BYTES);
      if (body instanceof Response) return body;
      if (!LEGAL_SLUG.test(ctx.params.slug) || !LEGAL_SLUG.test(body.slug))
        return errorResponse('invalid_body', 'The slug is 1 to 100 of a-z, 0-9 and "-".');
      const r = store.renamePage(ctx.params.slug, body);
      if (r.status === 'missing') return notFound();
      return r.status === 'taken' ? taken() : jsonResponse({ page: r.page });
    },
    pageDelete: async (req, ctx) => {
      const denied = adminOnly(req);
      if (denied) return denied;
      return store.removePage(ctx.params.slug) ? new Response(null, { status: 204 }) : notFound();
    },
  };
}
