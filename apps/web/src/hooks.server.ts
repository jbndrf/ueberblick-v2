import type { Handle, HandleServerError, RequestEvent, ServerInit } from '@sveltejs/kit';
import {
  ensureFirstAdmin,
  logAuthFailure,
  logHttpAccess,
  logHttpError,
  previewKeys,
} from '@ueberblick/server';
import { config } from '$lib/server/config';
import { withReferrerPolicyFor, withSecurityHeaders } from '$lib/server/security/headers';
import { entryGuard } from '$lib/server/security/entry';
import { renewCookie } from '$lib/server/handlers/auth';
import {
  createMapOriginsStore,
  recomputeAfterDeploys,
  type MapOriginsStore,
} from '$lib/server/security/map-origins';
import { runtime } from '$lib/server/runtime';
import { signedOutRedirect } from '$lib/participant/boot/signed-out';
import { sessionsOf } from '$lib/server/sessions';

/** The map origins of the deployed and preview configs that the CSP allows (`security/map-origins.ts`). */
let mapOrigins: MapOriginsStore | undefined;

/**
 * Runs once at server start: creates the runtime, which starts the timers loop, and the first admin from `.env` when
 * the account list is empty, before the first request.
 */
export const init: ServerInit = async () => {
  const rt = runtime();
  mapOrigins = createMapOriginsStore({
    keys: () => [...rt.projectKeys(), ...previewKeys(rt.control)],
    db: rt.projectDb,
  });
  recomputeAfterDeploys(rt.services, mapOrigins);
  await ensureFirstAdmin(
    { control: rt.control, auth: rt.auth, say: (line) => process.stdout.write(`${line}\n`) },
    config().admin,
  );
};

/** Sign-in routes whose 401 answers are logged as `auth.failed`. */
const SIGN_IN_PATHS: ReadonlySet<string> = new Set(['/api/auth/exchange', '/api/auth/login']);
/** When each request started, for the duration of `http.error` (a request is one object for handle and handleError). */
const started = new WeakMap<Request, number>();

/** `getClientAddress` throws when the platform gives none; the logger then writes `invalid`. */
const addressOf = (event: RequestEvent): string => {
  try {
    return event.getClientAddress();
  } catch {
    return '';
  }
};

/** A request that ended in a server error: one `http.error` line (route pattern, truncated IP, duration; no message). */
export const handleError: HandleServerError = ({ event, status }) => {
  logHttpError(runtime().log, {
    status,
    route: event.route.id,
    ip: addressOf(event),
    ms: performance.now() - (started.get(event.request) ?? performance.now()),
  });
};

/**
 * First asks the transport gate (`lib/server/tls/gate.ts`): forwarded headers count only from a trusted proxy (the real
 * client address then replaces the proxy's in `getClientAddress`), and in direct mode plain http is redirected to https.
 * Then refuses bodies above `UPLOAD_LIMIT` with 413, resolves the session cookie into `locals.admin` (null when
 * anonymous), sets the page language from Accept-Language (German unless English is asked for first) and adds the
 * security headers to every answer (the CSP carries the map origins of the deployed and preview configs, WP-957), the redirect and the 413 included. HSTS goes out when the gate saw the client use
 * HTTPS (directly through the front or behind a trusted proxy that forwards https). Pages already carry
 * SvelteKit's nonce CSP, which is kept.
 */
const answer: Handle = async ({ event, resolve }) => {
  const rt = runtime();
  const { gate, early } = entryGuard({
    config: config(),
    uploadLimitBytes: config().uploadLimit.bytes,
    request: event.request,
    peer: addressOf(event),
    path: event.url.pathname + event.url.search,
  });
  event.getClientAddress = () => gate.clientAddress;
  if (early) return early;
  // Two sessions, resolved independently (v3 hooks.server.ts:84-97); a cookie holding the other kind counts as absent.
  const { admin, participant, participantId } = sessionsOf(event.request, rt.auth);
  event.locals.participant = participant;
  event.locals.admin = admin;
  // WP-731: nobody signed in as a participant reaches /login without the app asking for a bootstrap that answers 401
  // (v3's (participant) layout guard); an admin-only cookie does not count.
  const to = signedOutRedirect({
    method: event.request.method,
    path: event.url.pathname,
    signedIn: participant !== null,
  });
  if (to !== undefined)
    return withSecurityHeaders(new Response(null, { status: 303, headers: { location: to } }), gate.https);
  const lang = /^\s*en\b/i.test(event.request.headers.get('accept-language') ?? '') ? 'en' : 'de';
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html.replace('<html lang="de">', `<html lang="${lang}">`),
  });
  renewCookie(response, participantId, participant);
  if (SIGN_IN_PATHS.has(event.url.pathname)) await logAuthFailure(rt.log, response, addressOf(event));
  withReferrerPolicyFor(response, event.url.pathname);
  return withSecurityHeaders(response, gate.https, mapOrigins?.current() ?? []);
};

/**
 * Writes one `http.access` line per request, after the answer is known (the early answers and the 303 included):
 * method, route pattern (never the path or query: login tokens live in URLs), status, truncated address, duration.
 */
export const handle: Handle = async (input) => {
  const { event } = input;
  started.set(event.request, performance.now());
  let status = 500;
  try {
    const response = await answer(input);
    status = response.status;
    return response;
  } finally {
    logHttpAccess(runtime().log, {
      method: event.request.method,
      route: event.route.id,
      status,
      ip: addressOf(event),
      ms: performance.now() - (started.get(event.request) ?? performance.now()),
    });
  }
};
