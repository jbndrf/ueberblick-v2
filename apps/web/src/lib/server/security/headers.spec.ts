import { describe, expect, it } from 'vitest';
import { CSP_DIRECTIVES } from './csp-directives.js';
import { securityHeaders, widenCsp, withReferrerPolicyFor, withSecurityHeaders } from './headers';

describe('securityHeaders', () => {
  it('sets every header of the baseline', () => {
    const h = securityHeaders(false);
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy']).toBe('geolocation=(self), camera=(self), microphone=()');
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('sets HSTS only for HTTPS requests', () => {
    expect(securityHeaders(true)['strict-transport-security']).toContain('max-age=');
    expect(securityHeaders(false)['strict-transport-security']).toBeUndefined();
  });

  it('the CSP is enforced and no broader than the app needs', () => {
    expect(CSP_DIRECTIVES['script-src']).toEqual(['self']);
    // blob: shows a photo picked or taken on the device before it is uploaded (URL.createObjectURL; owner bug 2026-10-03).
    expect(CSP_DIRECTIVES['img-src']).toEqual(['self', 'data:', 'blob:']);
    expect(CSP_DIRECTIVES['worker-src']).toEqual(['self', 'blob:']);
    expect(CSP_DIRECTIVES['connect-src']).toEqual(['self']);
    expect(CSP_DIRECTIVES['default-src']).toEqual(['self']);
    expect(securityHeaders(false)).not.toHaveProperty('content-security-policy-report-only');
  });
});

describe('withSecurityHeaders', () => {
  it('adds the headers to any response, a 404 and a JSON answer included', () => {
    for (const res of [new Response('x', { status: 404 }), Response.json({ ok: true })]) {
      const out = withSecurityHeaders(res, false);
      for (const name of Object.keys(securityHeaders(false)))
        expect(out.headers.get(name), name).toBeTruthy();
    }
  });

  it('keeps a CSP the response already has (SvelteKit nonce mode on pages)', () => {
    const res = new Response('x', { headers: { 'content-security-policy': "script-src 'nonce-abc'" } });
    expect(withSecurityHeaders(res, true).headers.get('content-security-policy')).toBe(
      "script-src 'nonce-abc'",
    );
  });
});

describe('widenCsp (WP-957)', () => {
  it('adds the origins to connect-src and img-src only, and is a no-op without origins', () => {
    const v = "img-src 'self' data:; connect-src 'self'; script-src 'self' 'nonce-a'";
    expect(widenCsp(v, [])).toBe(v);
    const out = widenCsp(v, ['https://a.example', 'https://b.example']);
    expect(out).toContain("img-src 'self' data: https://a.example https://b.example");
    expect(out).toContain("connect-src 'self' https://a.example https://b.example");
    expect(out).toContain("script-src 'self' 'nonce-a'");
  });
});

describe('withReferrerPolicyFor', () => {
  it('/login sends no Referer (its address carries the token); other pages keep the baseline (WP-772)', () => {
    const login = withSecurityHeaders(withReferrerPolicyFor(new Response('x'), '/login'), true);
    expect(login.headers.get('referrer-policy')).toBe('no-referrer');
    const map = withSecurityHeaders(withReferrerPolicyFor(new Response('x'), '/map'), true);
    expect(map.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
});
