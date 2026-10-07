/**
 * The `http.error` and `auth.failed` events (docs/process/logging.md), framework-free so `hooks.server.ts` stays a
 * few lines. Only declared fields are logged: never the error message (it can carry values), the URL (it can carry
 * ids of people) or the request body.
 */
import { randomUUID } from 'node:crypto';
import { AUTH_ERRORS } from '../../auth/registry';
import type { Logger } from '../../log';

export interface HttpFailure {
  /** The response status the framework chose. Only server errors (500 and above) are logged: a 404 is a probe, not a fault. */
  readonly status: number;
  /** The route pattern (`/api/p/[project]/sync`), not the URL; `unmatched` when no route matched. */
  readonly route: string | null;
  /** The client address as the framework resolved it; the logger truncates it. */
  readonly ip: string;
  /** Time since the request started (ms). */
  readonly ms: number;
}

/** A route with everything from the first `?` or `#` removed: login tokens and ids live in query strings. */
const withoutQuery = (route: string): string => route.replace(/[?#].*$/s, '');

/** A request ended in a server error. The code is fixed: the error itself is not written. */
export function logHttpError(log: Logger, f: HttpFailure): void {
  if (f.status < 500) return;
  log.log('http.error', {
    requestId: randomUUID(),
    route: f.route === null ? 'unmatched' : withoutQuery(f.route),
    code: 'unhandled',
    ip: f.ip,
    ms: f.ms,
  });
}

export interface HttpAccess {
  readonly method: string;
  /** The route pattern, never the path; `null` when no route matched. */
  readonly route: string | null;
  readonly status: number;
  /** The client address as the transport gate resolved it; the logger truncates it. */
  readonly ip: string;
  /** Time since the request started (ms). */
  readonly ms: number;
}

/** One `http.access` line per request (v3's nginx access log, anonymised). Never throws into the request. */
export function logHttpAccess(log: Logger, a: HttpAccess): void {
  try {
    log.log('http.access', {
      method: a.method,
      route: a.route === null ? 'unmatched' : withoutQuery(a.route),
      status: a.status,
      ip: a.ip,
      ms: a.ms,
    });
  } catch {
    // A failing sink must not fail the answer.
  }
}

/** `auth.failed` code for an attempt the throttle refused (429). */
export const AUTH_THROTTLED = 'throttled';
/** `auth.failed` code for a rejected TOTP confirm (400). */
export const AUTH_TOTP_REJECTED = 'totp_rejected';

/** Actor id logged when the caller could not be identified (every failed sign-in). */
export const ANONYMOUS_ACTOR = 'anonymous';

/**
 * A sign-in answer from the exchange or login route. A 401 with `{ code }` logs `auth.failed` with the registered
 * auth error code; a 429 (the throttle refused the attempt: the brute-force signal) logs `throttled`. Anything else
 * (other status, unknown code, no JSON) logs nothing.
 */
export async function logAuthFailure(log: Logger, response: Response, ip: string): Promise<void> {
  if (response.status === 429)
    return log.log('auth.failed', { code: AUTH_THROTTLED, ip, actor: ANONYMOUS_ACTOR });
  if (response.status !== 401) return;
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return;
  }
  const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
  if (typeof code !== 'string' || !AUTH_ERRORS.keys.includes(code as never)) return;
  log.log('auth.failed', { code, ip, actor: ANONYMOUS_ACTOR });
}
