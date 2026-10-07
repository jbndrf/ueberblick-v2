/** The sign-in exchange as the login page needs it: a refusal becomes the text key the participant sees. */
import type { MessageKey } from '../messages';
import { announceSessionChanged } from '../session-channel';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Problem {
  readonly key: MessageKey;
  readonly values?: Readonly<Record<string, number>>;
}
export type ExchangeResult =
  { readonly ok: true } | { readonly ok: false; readonly problem: Problem; readonly consentRequired?: true };

/** Auth registry code (`packages/server/src/auth/registry.ts`) to the text; unknown codes get the generic text. */
const BY_CODE: Readonly<Record<string, MessageKey>> = {
  credential_unknown: 'login_err_invalid',
  credential_revoked: 'login_err_invalid',
  credential_expired: 'login_err_expired',
  participant_disabled: 'login_err_inactive',
};

const refuse = (problem: Problem): ExchangeResult => ({ ok: false, problem });

export async function exchange(fetch: FetchLike, token: string): Promise<ExchangeResult> {
  let res: Response;
  try {
    res = await fetch('/api/auth/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch {
    return refuse({ key: 'login_err_offline' });
  }
  if (res.ok) {
    announceSessionChanged(false); // other tabs hold the cookie too: they look at the session again; this document's map starts itself (WP-768)
    return { ok: true };
  }
  if (res.status === 429) {
    const seconds = Number(res.headers.get('retry-after'));
    const minutes = Math.max(1, Number.isFinite(seconds) ? Math.ceil(seconds / 60) : 1);
    return refuse({ key: 'login_err_rate_limited', values: { minutes } });
  }
  let code: unknown;
  try {
    code = ((await res.json()) as { code?: unknown }).code;
  } catch {
    code = undefined;
  }
  // The operator requires consent and the cookie is missing: the page opens the consent modal (WP-638).
  if (code === 'consent_required')
    return { ok: false, problem: { key: 'login_err_generic' }, consentRequired: true };
  return refuse({ key: (typeof code === 'string' ? BY_CODE[code] : undefined) ?? 'login_err_generic' });
}
