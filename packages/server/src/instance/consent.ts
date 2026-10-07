import { CONSENT_DECISIONS, INSTANCE_ERRORS, type ConsentDecision } from './registry';
import type { InstanceStore } from './store';

export const CONSENT_COOKIE = 'consent';
/** One year, as v3 (`login/+page.server.ts:141-162`). */
export const CONSENT_MAX_AGE_S = 60 * 60 * 24 * 365;

/** The visitor's decision from the `consent` cookie, or undefined when absent or not a known decision. */
export function readConsent(req: Request): ConsentDecision | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== CONSENT_COOKIE) continue;
    const value = rest.join('=');
    return CONSENT_DECISIONS.has(value) ? value : undefined;
  }
  return undefined;
}

export function consentCookie(decision: ConsentDecision, opts: { secure: boolean }): string {
  const parts = [
    `${CONSENT_COOKIE}=${decision}`,
    'Path=/',
    `Max-Age=${CONSENT_MAX_AGE_S}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * The server-side gate (v3 `login/+page.server.ts:168-185`): a 403 with the registry code when consent is required
 * and not accepted, otherwise null. Sign-in (`exchange`) and, later, self-join call it before they do anything.
 */
export function consentRefusal(store: Pick<InstanceStore, 'settings'>, req: Request): Response | null {
  if (!store.settings().requireConsent || readConsent(req) === 'accepted') return null;
  const code = 'consent_required';
  return new Response(JSON.stringify({ code }), {
    status: INSTANCE_ERRORS.get(code).status,
    headers: { 'content-type': 'application/json' },
  });
}
