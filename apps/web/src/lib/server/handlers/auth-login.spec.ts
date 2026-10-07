import { describe, expect, it, vi } from 'vitest';
import { createAuth, openControlDb, type AuthDeps } from '@ueberblick/server';

// WP-942: the admin login handler with the real auth service over an in-memory control.db.
const PASSWORD = 'correct horse battery';
const DAY = 24 * 3600_000;
const state: { admin: NonNullable<AuthDeps['admin']> } = { admin: { totp: false, rememberMs: 30 * DAY } };
const control = openControlDb(':memory:');
const auths = new Map<boolean, ReturnType<typeof createAuth>>();
const authFor = (): ReturnType<typeof createAuth> => {
  const key = state.admin.totp;
  let a = auths.get(key);
  if (!a) {
    a = createAuth({ control, now: () => new Date(), participantRoles: () => [], admin: state.admin });
    auths.set(key, a);
  }
  return a;
};
vi.mock('../runtime', () => ({
  runtime: () => ({ auth: authFor(), secureCookies: false, log: { log: () => undefined } }),
}));
const { login } = await import('./auth');

let n = 0;
const call = (body: unknown) =>
  ({
    locals: { admin: null, participant: null },
    params: {},
    request: new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }),
    getClientAddress: () => `10.0.${n++}.1`,
  }) as unknown as Parameters<typeof login>[0];

await authFor().createAdmin('chef@example.org', PASSWORD);
const expiresIn = (res: Response): number => {
  const m = /Expires=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
  return Date.parse(m?.[1] ?? '') - Date.now();
};

describe('POST /api/auth/login with ADMIN_TOTP=off', () => {
  it('signs in with e-mail and password alone', async () => {
    state.admin = { totp: false, rememberMs: 30 * DAY };
    const res = await login(call({ email: 'chef@example.org', password: PASSWORD }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('ub_session_admin=');
  });

  it('refuses a wrong password with 401 invalid_login', async () => {
    const res = await login(call({ email: 'chef@example.org', password: 'wrong password!' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'invalid_login' });
  });

  it('asks for e-mail and password', async () => {
    expect((await login(call({ email: 'chef@example.org' }))).status).toBe(400);
  });

  it('lasts 12 hours, or 30 days with "angemeldet bleiben"', async () => {
    const short = await login(call({ email: 'chef@example.org', password: PASSWORD }));
    const long = await login(call({ email: 'chef@example.org', password: PASSWORD, remember: true }));
    expect(Math.abs(expiresIn(short) - 12 * 3600_000)).toBeLessThan(5_000);
    expect(Math.abs(expiresIn(long) - 30 * DAY)).toBeLessThan(5_000);
  });
});

describe('POST /api/auth/login with ADMIN_TOTP=on', () => {
  it('hands an account without TOTP its otpauth URI once the password is right, and never otherwise', async () => {
    state.admin = { totp: true, rememberMs: 30 * DAY };
    const wrong = await login(call({ email: 'chef@example.org', password: 'wrong password!', totp: '' }));
    expect(await wrong.json()).toEqual({ code: 'invalid_login' });
    const res = await login(call({ email: 'chef@example.org', password: PASSWORD, totp: '' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { code: string; otpauthUri: string };
    expect(body.code).toBe('mfa_not_enrolled');
    expect(body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
  });

  it('refuses a sign-in with a wrong code', async () => {
    const res = await login(call({ email: 'chef@example.org', password: PASSWORD, totp: '000000' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'invalid_login' });
  });
});
