/** What a scanned or typed text means for sign-in: a raw token, or a login link that carries one (fixes v3 bug B1). */

const fromParams = (raw: string, key: string): string | undefined => {
  const value = new URLSearchParams(raw).get(key);
  return value === null || value === '' ? undefined : value;
};

/** The token of the login link `/login?token=…` — the only link form the app issues and reads. */
export function tokenFromLocation(search: string): string | undefined {
  return fromParams(search.replace(/^\?/, ''), 'token');
}

/** The meaning of a scanned code: a token, a code that is not this app's, or nothing (the texts are in QrTab). */
export type ScanResult =
  { readonly kind: 'token'; readonly token: string } | { readonly kind: 'invalid' } | undefined;

/**
 * A raw token is accepted as is. A login link is accepted only from this app's own origin (passed in so this stays
 * testable); a link from anywhere else is an invalid code, never a token (v3: `participantLoginQrInvalid`).
 */
export function tokenFromScan(text: string, origin: string): ScanResult {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return undefined;
    }
    if (url.origin !== origin) return { kind: 'invalid' };
    const token = tokenFromLocation(url.search);
    return token === undefined ? undefined : { kind: 'token', token };
  }
  return { kind: 'token', token: trimmed };
}
