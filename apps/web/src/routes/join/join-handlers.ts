/**
 * `/join/<slug>` (WP-639, v3 `routes/(participant)/join/[slug]/+server.ts`): the public self-join link of a role.
 *
 *   GET  /join/<slug>         `view`:  creates NOTHING (v3 bug B12: link previews fetch a GET). 404 for an unknown or
 *                             switched-off slug (v3: "Not found"); a device that already holds a session of the
 *                             project goes straight on; otherwise the page that POSTs.
 *   POST /join/<slug>/start   `start`: creates the guest, opens the session cookie and redirects to `?next=` or `/map`.
 *
 * Throttled like v3: an unknown slug counts as a failed attempt. Consent (WP-638's gate, `consentRefusal`) comes first,
 * as in v3: with consent required and not given, the GET bounces to `/login?returnTo=<this link>` and the POST is 403;
 * no guest is created before the visitor accepted.
 */
import {
  consentRefusal,
  instanceStoreFor,
  joinAsGuest,
  resolveSlug,
  sessionCookie,
  type Principal,
} from '@ueberblick/server';
import { message } from '../../lib/participant/server-messages';
import { localeOf } from '../../lib/participant/locale-tag';
import { addressOf, throttle } from '../../lib/server/ratelimit';
import { runtime } from '../../lib/server/runtime';

export interface JoinCall {
  readonly request: Request;
  readonly params: Readonly<Record<string, string>>;
  readonly url: URL;
  readonly locals: { readonly participant: Principal | null };
  /** The name the guest typed on the join page (the route reads it from the form). */
  readonly name?: unknown;
  getClientAddress(): string;
}

/** Where to go after joining: `?next=` when it is a path of this app (v3: starts with `/`, not `//`), else the map. */
export function nextOf(url: URL): string {
  const next = url.searchParams.get('next');
  return next !== null && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')
    ? next
    : '/map';
}

export type JoinView =
  | { readonly kind: 'form'; readonly slug: string; readonly next: string }
  | { readonly kind: 'go'; readonly to: string }
  | { readonly kind: 'consent'; readonly to: string }
  | { readonly kind: 'refused'; readonly status: 404 | 429; readonly text: string };

const textOf = (call: JoinCall, key: 'join_not_found' | 'join_throttled' | 'join_failed'): string =>
  message(localeOf(call.request.headers.get('accept-language') ?? 'de'), key);

/** The GET: decides what the page shows. Never writes. */
export function view(call: JoinCall): JoinView {
  const slug = call.params['slug'] ?? '';
  const rt = runtime();
  if (consentRefusal(instanceStoreFor(rt), call.request) !== null) {
    const returnTo = `/join/${encodeURIComponent(slug)}${call.url.search}`;
    return { kind: 'consent', to: `/login?returnTo=${encodeURIComponent(returnTo)}` };
  }
  const attempt = throttle().attempt('join', addressOf(call), slug);
  if (attempt.refused) return { kind: 'refused', status: 429, text: textOf(call, 'join_throttled') };
  const target = resolveSlug(rt.control, slug);
  if (!target) {
    attempt.fail();
    return { kind: 'refused', status: 404, text: textOf(call, 'join_not_found') };
  }
  const next = nextOf(call.url);
  const p = call.locals.participant;
  if (p?.kind === 'participant' && p.projectId === target.projectId) return { kind: 'go', to: next };
  return { kind: 'form', slug, next };
}

const redirect = (to: string, cookie?: string): Response =>
  new Response(null, { status: 303, headers: { location: to, ...(cookie ? { 'set-cookie': cookie } : {}) } });

/** The POST: creates the guest (or signs the device's own guest in again) and redirects. */
export function start(call: JoinCall): Response {
  const slug = call.params['slug'] ?? '';
  const rt = runtime();
  const noConsent = consentRefusal(instanceStoreFor(rt), call.request);
  if (noConsent !== null) return noConsent;
  const attempt = throttle().attempt('join', addressOf(call), slug);
  if (attempt.refused) return attempt.refused;
  const r = joinAsGuest(
    {
      control: rt.control,
      projectDb: (key) => rt.projectDb(key),
      auth: rt.auth,
      now: () => new Date(rt.clock.now()),
    },
    slug,
    call.locals.participant,
    call.name,
  );
  if (!r.ok) {
    attempt.fail();
    return r.code === 'link_unknown'
      ? new Response(textOf(call, 'join_not_found'), { status: 404 })
      : new Response(textOf(call, 'join_failed'), { status: 500 });
  }
  attempt.succeed();
  const to = nextOf(call.url);
  return r.kind === 'existing'
    ? redirect(to)
    : redirect(to, sessionCookie('participant', r.session, { secure: rt.secureCookies }));
}
