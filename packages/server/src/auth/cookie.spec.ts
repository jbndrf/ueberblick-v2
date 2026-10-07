import { describe, expect, it } from 'vitest';
import { clearSessionCookie, readSessionCookie, sessionCookie } from './cookie';
import { SESSION_COOKIES } from './params';

describe('cookies (Web-standard Request/Response)', () => {
  it('sets HttpOnly, Secure, SameSite=Lax and round-trips', () => {
    const c = sessionCookie('participant', { id: 'abc', expiresAt: '2026-02-01T00:00:00.000Z' });
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/SameSite=Lax/);
    expect(c).toMatch(/Path=\//);
    expect(c).toMatch(/Expires=/);
    const req = new Request('https://x.test/', {
      headers: { cookie: 'a=b; ub_session_participant=abc; c=d' },
    });
    expect(readSessionCookie(req, 'participant')).toBe('abc');
    expect(readSessionCookie(new Request('https://x.test/'), 'participant')).toBeNull();
    expect(clearSessionCookie('participant')).toMatch(/Max-Age=0/);
  });

  it('has one cookie per session kind, with its own name (WP-705)', () => {
    const session = { id: 'abc', expiresAt: '2026-02-01T00:00:00.000Z' };
    expect(sessionCookie('participant', session)).toMatch(/^ub_session_participant=abc;/);
    expect(sessionCookie('admin', session)).toMatch(/^ub_session_admin=abc;/);
    expect(clearSessionCookie('participant')).toMatch(/^ub_session_participant=;/);
    expect(clearSessionCookie('admin')).toMatch(/^ub_session_admin=;/);
    const admin = sessionCookie('admin', session);
    for (const attr of [/HttpOnly/, /SameSite=Lax/, /Secure/, /Path=\//]) expect(admin).toMatch(attr);
    for (const attr of [/HttpOnly/, /SameSite=Lax/, /Secure/, /Path=\//])
      expect(clearSessionCookie('admin')).toMatch(attr);
    expect(SESSION_COOKIES.participant).not.toBe(SESSION_COOKIES.admin);
  });

  it('reads only the cookie of the kind asked for', () => {
    const both = new Request('https://x.test/', {
      headers: { cookie: 'ub_session_participant=pid; ub_session_admin=aid' },
    });
    expect(readSessionCookie(both, 'participant')).toBe('pid');
    expect(readSessionCookie(both, 'admin')).toBe('aid');
    const onlyParticipant = new Request('https://x.test/', {
      headers: { cookie: 'ub_session_participant=pid' },
    });
    expect(readSessionCookie(onlyParticipant, 'admin')).toBeNull();
    const onlyAdmin = new Request('https://x.test/', { headers: { cookie: 'ub_session_admin=aid' } });
    expect(readSessionCookie(onlyAdmin, 'participant')).toBeNull();
  });
});
