import { MAP_DIRECTIVES, cspHeader } from './csp-directives.js';

/** `geolocation` and `camera` stay `self`: the map's position button and the in-app QR scanner. */
const PERMISSIONS = 'geolocation=(self), camera=(self), microphone=()';

/**
 * A CSP header value with the map origins added to `connect-src` and `img-src`, the rest (SvelteKit's nonce included)
 * untouched. Pages get their CSP from SvelteKit at build-time directives (`kit.csp`), which cannot know the origins of
 * the deployed project files, so the origins are added here on the way out.
 */
export function widenCsp(value: string, origins: readonly string[]): string {
  if (origins.length === 0) return value;
  return value
    .split(';')
    .map((d) => {
      const name = d.trim().split(/\s+/)[0] ?? '';
      return MAP_DIRECTIVES.includes(name) ? `${d.trimEnd()} ${origins.join(' ')}` : d;
    })
    .join(';');
}

/** The security headers of a response (lower-case names). HSTS only when the request came in over HTTPS. */
export function securityHeaders(https: boolean, mapOrigins: readonly string[] = []): Record<string, string> {
  return {
    'content-security-policy': cspHeader(mapOrigins),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': PERMISSIONS,
    ...(https ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}

/**
 * Adds the headers a response does not carry yet. SvelteKit's own nonce CSP on pages is kept but widened with the map
 * origins (`widenCsp`); every other response gets the full CSP with them. Mutates and returns it.
 */
export function withSecurityHeaders(
  response: Response,
  https: boolean,
  mapOrigins: readonly string[] = [],
): Response {
  const own = response.headers.get('content-security-policy');
  if (own !== null) response.headers.set('content-security-policy', widenCsp(own, mapOrigins));
  for (const [name, value] of Object.entries(securityHeaders(https, mapOrigins)))
    if (!response.headers.has(name)) response.headers.set(name, value);
  return response;
}

/**
 * Pages whose address carries a credential (`/login?token=…`) send no Referer: on a first visit without the service
 * worker the same-origin script requests would otherwise carry the token in the Referer header (WP-772).
 */
export function withReferrerPolicyFor(response: Response, pathname: string): Response {
  if (pathname === '/login') response.headers.set('referrer-policy', 'no-referrer');
  return response;
}
