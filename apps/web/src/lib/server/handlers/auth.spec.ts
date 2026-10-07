import { describe, expect, it, vi } from 'vitest';
import { sessionCookie, type Principal, type Session } from '@ueberblick/server';

const revokeSession = vi.fn();
const exchangeFn = vi.fn();
const rt = { secureCookies: true, auth: { revokeSession, exchange: exchangeFn } };
// The consent gate is WP-638's and has its own spec (`auth-consent.spec.ts`); here nobody is refused.
vi.mock('@ueberblick/server', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  instanceStoreFor: () => ({}),
  consentRefusal: () => null,
}));
vi.mock('../runtime', () => ({ runtime: () => rt }));
vi.mock('../ratelimit', () => ({
  addressOf: () => 'a',
  throttle: () => ({ attempt: () => ({ refused: null, fail: () => undefined, succeed: () => undefined }) }),
}));
const { exchange, logout, logoutAdmin, logoutRedirect, renewCookie, rootTarget } = await import('./auth');

const A: Principal = { kind: 'participant', id: 'A', projectId: 'p', roles: [] };
const B: Principal = { kind: 'participant', id: 'B', projectId: 'p', roles: [] };
const admin: Principal = { kind: 'admin', id: 'x', projectId: null, roles: [] };
const sid = (id: string) => `ub_session_participant=${id}`;
const sessionFor = (principal: Principal): Session => ({
  id: 'new-session',
  principal,
  expiresAt: '2027-01-01T00:00:00.000Z',
});

const call = (
  principal: Principal | null,
  cookie: string | null,
  method = 'POST',
  body: unknown = { token: 't' },
) =>
  ({
    locals: { admin: null, participant: principal },
    params: {},
    request: new Request('http://x/', {
      method,
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      headers: cookie ? { cookie } : {},
    }),
    getClientAddress: () => '127.0.0.1',
  }) as unknown as Parameters<typeof exchange>[0];

describe('root redirect (WP-608)', () => {
  it('goes to /login without a session and to /map with a participant session', () => {
    expect(rootTarget({ admin: null, participant: null })).toBe('/login');
    expect(rootTarget({ admin: null, participant: A })).toBe('/map');
    expect(rootTarget({ admin, participant: null })).toBe('/builder');
    expect(rootTarget({ admin, participant: A })).toBe('/map');
  });
});

describe('takeover on exchange (WP-608)', () => {
  it('revokes the other participant session after the new one is created and sets the new cookie', async () => {
    revokeSession.mockClear();
    exchangeFn.mockReturnValue(sessionFor(B));
    const res = await exchange(call(A, sid('old-session')));
    expect(res.status).toBe(200);
    expect(revokeSession).toHaveBeenCalledExactlyOnceWith('old-session');
    expect(exchangeFn.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(
      revokeSession.mock.invocationCallOrder[0] ?? 0,
    );
    expect(res.headers.get('set-cookie')).toContain('new-session');
  });

  it('revokes the old session id when the same participant signs in again', async () => {
    revokeSession.mockClear();
    exchangeFn.mockReturnValue(sessionFor(A));
    await exchange(call(A, sid('old-session')));
    expect(revokeSession).toHaveBeenCalledExactlyOnceWith('old-session');
  });

  it('does not revoke when nobody is signed in, or when the exchange fails', async () => {
    revokeSession.mockClear();
    exchangeFn.mockReturnValue(sessionFor(B));
    await exchange(call(null, null));
    exchangeFn.mockReturnValue({ code: 'credential_unknown' });
    await exchange(call(A, sid('old-session')));
    expect(revokeSession).not.toHaveBeenCalled();
  });
});

describe('cookie renewal (WP-608)', () => {
  const now = Date.parse('2026-10-01T00:00:00.000Z');
  it('re-sets the cookie with the renewed expiry when the session slid', () => {
    const renewedExpiresAt = now + 90 * 86_400_000;
    const res = renewCookie(new Response('x'), 's1', { ...A, renewedExpiresAt });
    const expected = sessionCookie(
      'participant',
      { id: 's1', expiresAt: new Date(renewedExpiresAt).toISOString() },
      { secure: true },
    );
    expect(res.headers.get('set-cookie')).toBe(expected);
    expect(expected).toMatch(/HttpOnly/);
    expect(expected).toMatch(/Secure/);
    expect(expected).toMatch(/SameSite=Lax/);
  });

  it('keeps the new cookie of a takeover exchange when the old session was due to slide', async () => {
    exchangeFn.mockReturnValue(sessionFor(B));
    const res = await exchange(call(A, sid('old-session')));
    renewCookie(res, 'old-session', { ...A, renewedExpiresAt: now + 90 * 86_400_000 });
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain('new-session');
    expect(cookies.join()).not.toContain('old-session');
  });

  it('keeps the cleared cookie of a logout when the session was due to slide', () => {
    const renewed = { ...A, renewedExpiresAt: now + 90 * 86_400_000 };
    for (const res of [logoutRedirect(call(A, sid('s9'))), logout(call(A, sid('s9')))]) {
      renewCookie(res, 's9', renewed);
      const cookies = res.headers.getSetCookie();
      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toMatch(/Max-Age=0/);
    }
  });

  it('leaves the response alone when the session did not slide', () => {
    expect(renewCookie(new Response('x'), 's1', A).headers.has('set-cookie')).toBe(false);
    expect(renewCookie(new Response('x'), null, null).headers.has('set-cookie')).toBe(false);
  });
});

describe('two sessions in one browser (WP-705)', () => {
  const both = `${sid('p-sess')}; ub_session_admin=a-sess`;

  it('a participant exchange leaves the admin session alone: it revokes only the participant cookie', async () => {
    revokeSession.mockClear();
    exchangeFn.mockReturnValue(sessionFor(B));
    const res = await exchange(call(A, both));
    expect(revokeSession).toHaveBeenCalledExactlyOnceWith('p-sess');
    expect(res.headers.get('set-cookie')).toMatch(/^ub_session_participant=new-session/);
  });

  it('participant sign-out ends only the participant session and clears only its cookie', () => {
    for (const res of [logoutRedirect(call(A, both)), logout(call(A, both))]) {
      expect(res.headers.get('set-cookie')).toMatch(/^ub_session_participant=;.*Max-Age=0/);
    }
    expect(revokeSession).not.toHaveBeenCalledWith('a-sess');
  });

  it('admin sign-out ends only the admin session and clears only its cookie', () => {
    revokeSession.mockClear();
    const res = logoutAdmin(call(admin, both));
    expect(revokeSession).toHaveBeenCalledExactlyOnceWith('a-sess');
    expect(res.headers.get('set-cookie')).toMatch(/^ub_session_admin=;.*Max-Age=0/);
  });
});

describe('logout (WP-608)', () => {
  it.each(['GET', 'POST'])('%s revokes the session, clears the cookie and answers 303 /login', (method) => {
    revokeSession.mockClear();
    const res = logoutRedirect(call(A, sid('s9'), method));
    expect(revokeSession).toHaveBeenCalledExactlyOnceWith('s9');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login');
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });
});
