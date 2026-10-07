import { SESSION_COOKIES, type SessionKind } from './params';

const API_TOKEN = 'ubk_';
/** `authenticate` gets an API token as `api:<token>`; `:` is not in a session id's alphabet, so the two never meet. */
export const API_REQUEST_PREFIX = 'api:';

export interface CookieOptions {
  /** Default true. Only tests and plain-http local development turn it off. */
  readonly secure?: boolean;
}

/** `Set-Cookie` value for a fresh session: HttpOnly, Secure, SameSite=Lax. */
export function sessionCookie(
  kind: SessionKind,
  session: { id: string; expiresAt: string },
  opts: CookieOptions = {},
): string {
  const parts = [
    `${SESSION_COOKIES[kind]}=${session.id}`,
    'Path=/',
    `Expires=${new Date(session.expiresAt).toUTCString()}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (opts.secure !== false) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(kind: SessionKind, opts: CookieOptions = {}): string {
  const parts = [`${SESSION_COOKIES[kind]}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure !== false) parts.push('Secure');
  return parts.join('; ');
}

/**
 * The credential of a request for one session kind, in the form `Auth.authenticate` takes: the session id from that
 * kind's cookie only (the other kind's cookie is never looked at); else, for `participant`, an API token (`ubk_...`,
 * WP-388) from `Authorization: Bearer <token>` or from HTTP Basic (QGIS: the token as user name, or as password); else
 * null. An admin read never returns an API token (`readApiToken` does, for project endpoints).
 */
export function readSessionCookie(request: Request, kind: SessionKind): string | null {
  const header = request.headers.get('cookie');
  if (header) {
    for (const part of header.split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIES[kind]) {
        const id = part.slice(i + 1).trim();
        if (id) return id;
      }
    }
  }
  return kind === 'participant' ? apiTokenOf(request.headers.get('authorization')) : null;
}

/** The API token of a request (`api:<token>`), from Bearer or Basic; null if none. Admin tokens (WP-1070) are read only by project endpoints, never by the admin app. */
export function readApiToken(request: Request): string | null {
  return apiTokenOf(request.headers.get('authorization'));
}

function apiTokenOf(authorization: string | null): string | null {
  if (!authorization) return null;
  const space = authorization.indexOf(' ');
  const scheme = authorization.slice(0, space).toLowerCase();
  const value = authorization.slice(space + 1).trim();
  if (scheme === 'bearer') return value.startsWith(API_TOKEN) ? `${API_REQUEST_PREFIX}${value}` : null;
  if (scheme !== 'basic') return null;
  const [user = '', ...rest] = Buffer.from(value, 'base64').toString('utf8').split(':');
  const found = [user, rest.join(':')].find((part) => part.startsWith(API_TOKEN));
  return found === undefined ? null : `${API_REQUEST_PREFIX}${found}`;
}
