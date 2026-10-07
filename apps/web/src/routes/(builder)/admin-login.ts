/**
 * The admin sign-in page's logic (WP-180): the `next` check and the call to `POST /api/auth/login` with its error
 * mapping. The page is a thin shell over these two, so they are tested without a browser.
 */
import type { MessageKey } from '@ueberblick/builder';

/** Where a sign-in without `next` goes. */
export const BUILDER_HOME = '/builder';
const ORIGIN = 'http://same-origin.invalid';
// A backslash or a control character in a redirect target is refused (browsers read `\` as `/`).
const FORBIDDEN = new RegExp(
  `[\\\\${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
);

/**
 * `raw` when it is a same-origin path (one leading slash, not `//`, no backslash, no control character), else the
 * builder home. A redirect target from the address bar is never trusted beyond this.
 */
export function safeNext(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return BUILDER_HOME;
  if (!raw.startsWith('/') || raw.startsWith('//') || FORBIDDEN.test(raw)) return BUILDER_HOME;
  return new URL(raw, ORIGIN).origin === ORIGIN ? raw : BUILDER_HOME;
}

export interface Credentials {
  readonly email: string;
  readonly password: string;
  /** Blank when `ADMIN_TOTP=off` (the field is hidden) and for an admin who still has to enrol. */
  readonly totp: string;
  /** "30 Tage angemeldet bleiben". */
  readonly remember: boolean;
}

export type SignInProblem = Extract<
  MessageKey,
  'login_invalid' | 'login_not_enrolled' | 'login_throttled' | 'login_failed' | 'login_offline'
>;
export type SignInResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly problem: SignInProblem;
      /** With `login_not_enrolled`: the secret to enrol, to show as a QR code (once). */
      readonly otpauthUri?: string;
    };

/** The message for a refused attempt. A wrong password and a wrong code share one, so neither field is named. */
export function loginProblem(status: number, code: string | undefined): SignInProblem {
  if (status === 429) return 'login_throttled';
  if (status === 401) return code === 'mfa_not_enrolled' ? 'login_not_enrolled' : 'login_invalid';
  return 'login_failed';
}

/** Ends the admin session only (the server clears its cookie; a participant session stays). The caller then goes to `/admin/login`. */
export async function signOut(doFetch: typeof fetch): Promise<void> {
  await doFetch('/admin/logout', { method: 'POST', redirect: 'manual' }).catch(() => undefined);
}

/** Calls the login API; on success the server has set the session cookie. */
export async function signIn(doFetch: typeof fetch, credentials: Credentials): Promise<SignInResult> {
  let res: Response;
  try {
    res = await doFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credentials),
    });
  } catch {
    return { ok: false, problem: 'login_offline' };
  }
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { code?: unknown; otpauthUri?: unknown };
  const problem = loginProblem(res.status, typeof body.code === 'string' ? body.code : undefined);
  return typeof body.otpauthUri === 'string' && problem === 'login_not_enrolled'
    ? { ok: false, problem, otpauthUri: body.otpauthUri }
    : { ok: false, problem };
}

/** The enrolment QR code as an inline SVG (loaded on first use; the one encoder is `lib/admin/participants/qr.ts`, A-026). */
export async function enrolQr(otpauthUri: string): Promise<string> {
  const { qrSvg } = await import('../../lib/admin/participants/qr');
  return qrSvg(otpauthUri);
}
