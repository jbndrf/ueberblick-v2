import { describe, expect, it } from 'vitest';
import type { Authenticated } from '@ueberblick/server';
import { sessionsOf } from '../../server/sessions';
import { signedOutRedirect } from './signed-out';

describe('signedOutRedirect (WP-731, v3 reference/src/routes/(participant)/+layout.server.ts:24)', () => {
  it('sends a signed-out page request for /map to /login, before the app asks for a bootstrap', () => {
    expect(signedOutRedirect({ method: 'GET', path: '/map', signedIn: false })).toBe('/login');
  });
  it('lets a signed-in request through', () => {
    expect(signedOutRedirect({ method: 'GET', path: '/map', signedIn: true })).toBeUndefined();
  });
  it('leaves every other path and method alone', () => {
    expect(signedOutRedirect({ method: 'GET', path: '/login', signedIn: false })).toBeUndefined();
    expect(
      signedOutRedirect({ method: 'GET', path: '/participant-api/bootstrap', signedIn: false }),
    ).toBeUndefined();
    expect(signedOutRedirect({ method: 'POST', path: '/map', signedIn: false })).toBeUndefined();
  });
});

describe('signed-out redirect decided by the participant session only (WP-731 x WP-705)', () => {
  const known: Record<string, Authenticated> = {
    pid: { kind: 'participant', id: 'anna', projectId: 'p1', roles: [] },
    aid: { kind: 'admin', id: 'root', projectId: null, roles: [] },
  };
  const auth = { authenticate: (id: string | null | undefined) => (id ? (known[id] ?? null) : null) };
  const redirectFor = (cookie: string) =>
    signedOutRedirect({
      method: 'GET',
      path: '/map',
      signedIn: sessionsOf(new Request('http://x/map', { headers: { cookie } }), auth).participant !== null,
    });
  it('redirects /map to /login when only an admin cookie is present', () => {
    expect(redirectFor('ub_session_admin=aid')).toBe('/login');
  });
  it('lets a participant cookie through, with or without an admin cookie', () => {
    expect(redirectFor('ub_session_participant=pid')).toBeUndefined();
    expect(redirectFor('ub_session_participant=pid; ub_session_admin=aid')).toBeUndefined();
  });
});
