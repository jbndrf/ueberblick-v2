import {
  clearSessionCookie,
  consentRefusal,
  instanceStoreFor,
  isAuthError,
  readSessionCookie,
  sessionCookie,
  type Authenticated,
  type Principal,
  type Session,
  type SessionKind,
} from '@ueberblick/server';
import { addressOf, throttle } from '../ratelimit';
import { runtime } from '../runtime';
import { isRecord, json, readJson, type Call } from './http';

const str = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);

function opened(kind: SessionKind, session: Session): Response {
  const secure = runtime().secureCookies;
  return json({ principal: session.principal, expiresAt: session.expiresAt }, 200, {
    'set-cookie': sessionCookie(kind, session, { secure }),
  });
}

/** QR exchange: `{ token, device? }` -> session cookie. */
export async function exchange(call: Call): Promise<Response> {
  // The consent gate comes before everything else: a refused visitor neither spends an attempt nor a credential.
  const refused = consentRefusal(instanceStoreFor(runtime()), call.request);
  if (refused !== null) return refused;
  const body = await readJson(call.request);
  if ('response' in body) return body.response;
  const token = isRecord(body.value) ? str(body.value['token']) : undefined;
  if (token === undefined) return json({ error: 'token is required' }, 400);
  const device = isRecord(body.value) ? str(body.value['device']) : undefined;
  const attempt = throttle().attempt('exchange', addressOf(call), token);
  if (attempt.refused) return attempt.refused;
  const r = runtime().auth.exchange(token, device);
  if (isAuthError(r)) {
    attempt.fail();
    return json({ code: r.code }, 401);
  }
  attempt.succeed();
  // A sign-in on a device that still has a participant session replaces it (another participant: takeover; the same
  // one: no lingering id). An admin session of the same browser is another cookie and stays (WP-705).
  const old = readSessionCookie(call.request, 'participant');
  if (old !== null) runtime().auth.revokeSession(old);
  return opened('participant', r);
}

/**
 * Admin login: `{ email, password, totp?, remember?, device? }` -> session cookie. With `ADMIN_TOTP=off` the code is
 * ignored. With it on, a blank code from an account without a confirmed TOTP answers 401 `mfa_not_enrolled` plus the
 * `otpauthUri` to enrol (shown once; it counts as a failed attempt so it stays throttled).
 */
export async function login(call: Call): Promise<Response> {
  const body = await readJson(call.request);
  if ('response' in body) return body.response;
  const b = isRecord(body.value) ? body.value : {};
  const [email, password] = [str(b['email']), str(b['password'])];
  if (email === undefined || password === undefined)
    return json({ error: 'email and password are required' }, 400);
  const attempt = throttle().attempt('login', addressOf(call), email);
  if (attempt.refused) return attempt.refused;
  const r = await runtime().auth.loginAdmin(email, password, str(b['totp']) ?? '', str(b['device']), {
    remember: b['remember'] === true,
  });
  if (isAuthError(r)) {
    attempt.fail();
    return json(
      r.otpauthUri === undefined ? { code: r.code } : { code: r.code, otpauthUri: r.otpauthUri },
      401,
      r.otpauthUri === undefined ? {} : { 'cache-control': 'no-store' },
    );
  }
  attempt.succeed();
  return opened('admin', r);
}

/** Where `/` leads: the work with a session, else the sign-in. */
export const rootTarget = (sessions: {
  readonly admin: Principal | null;
  readonly participant: Principal | null;
}): string => (sessions.participant !== null ? '/map' : sessions.admin !== null ? '/builder' : '/login');

/**
 * A sliding participant session got a later expiry: sets the participant cookie again with it, so the browser keeps
 * it as long. Admin sessions never slide.
 */
export function renewCookie(
  response: Response,
  sessionId: string | null,
  principal: Authenticated | null,
): Response {
  if (sessionId === null || principal?.renewedExpiresAt === undefined) return response;
  const cookieName = clearSessionCookie('participant', { secure: false }).split('=')[0] + '=';
  // The response already sets or clears the session cookie (sign-in, logout): the authenticated id is stale or revoked.
  if (response.headers.getSetCookie().some((c) => c.startsWith(cookieName))) return response;
  const expiresAt = new Date(principal.renewedExpiresAt).toISOString();
  response.headers.append(
    'set-cookie',
    sessionCookie('participant', { id: sessionId, expiresAt }, { secure: runtime().secureCookies }),
  );
  return response;
}

/** `/logout` (GET or POST): ends the participant session only, clears its cookie, goes to `/login`. Unsent runs stay on the device. */
export function logoutRedirect(call: Call): Response {
  return new Response(null, {
    status: 303,
    headers: { location: '/login', 'set-cookie': endSession(call, 'participant') },
  });
}

/** Ends the session of one kind and returns the `Set-Cookie` that clears its cookie; the other kind stays signed in. */
function endSession(call: Call, kind: SessionKind): string {
  const id = readSessionCookie(call.request, kind);
  if (id !== null) runtime().auth.revokeSession(id);
  return clearSessionCookie(kind, { secure: runtime().secureCookies });
}

/** `POST /api/auth/logout`: ends the participant session and clears its cookie. */
export function logout(call: Call): Response {
  return json({ ok: true }, 200, { 'set-cookie': endSession(call, 'participant') });
}

/** `POST /admin/logout` and the builder's sign-out: ends the admin session and clears its cookie. */
export function logoutAdmin(call: Call): Response {
  return json({ ok: true }, 200, { 'set-cookie': endSession(call, 'admin') });
}
