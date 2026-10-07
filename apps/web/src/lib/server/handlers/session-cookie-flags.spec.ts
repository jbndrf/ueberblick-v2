import { describe, expect, it, vi } from 'vitest';
import { createAuth, openControlDb } from '@ueberblick/server';

// WP-492 (verify step 1): the cookie a real sign-in answers with, on an https instance (secureCookies on).
const PASSWORD = 'correct horse battery';
const control = openControlDb(':memory:');
const auth = createAuth({
  control,
  now: () => new Date(),
  participantRoles: () => [],
  admin: { totp: false, rememberMs: 1000 },
});
vi.mock('../runtime', () => ({
  runtime: () => ({ auth, secureCookies: true, log: { log: () => undefined } }),
}));
const { login, logout } = await import('./auth');

const call = (body: unknown) =>
  ({
    locals: { admin: null, participant: null },
    params: {},
    request: new Request('https://x/', { method: 'POST', body: JSON.stringify(body) }),
    getClientAddress: () => '10.9.9.1',
  }) as unknown as Parameters<typeof login>[0];

const flagsOf = (res: Response): string[] =>
  (res.headers.get('set-cookie') ?? '').split(';').map((p) => p.trim());

describe('session cookie on https', () => {
  it('the admin login sets it HttpOnly, Secure, SameSite=Lax and site-wide', async () => {
    await auth.createAdmin('chef@example.org', PASSWORD);
    const res = await login(call({ email: 'chef@example.org', password: PASSWORD }));
    expect(res.status).toBe(200);
    const flags = flagsOf(res);
    expect(flags[0]).toMatch(/^ub_session_admin=.+/);
    for (const f of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(flags).toContain(f);
  });

  it('the cookie that ends a session carries the same flags', () => {
    const flags = flagsOf(logout(call({})));
    for (const f of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=0']) expect(flags).toContain(f);
  });
});
