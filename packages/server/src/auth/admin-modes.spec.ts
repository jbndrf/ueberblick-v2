import { describe, expect, it } from 'vitest';
import { openControlDb } from '../db/open';
import { isAuthError } from './contract';
import { MIN_PASSWORD_LENGTH, SESSION_TTL_MS } from './params';
import { createAuth, type AuthDeps } from './service';
import { base32Decode, totpAt } from './totp';

const START = Date.parse('2026-01-01T00:00:00.000Z');
const PASSWORD = 'correct horse battery';
const REMEMBER_MS = 30 * 24 * 3600_000;

function setup(admin: NonNullable<AuthDeps['admin']>) {
  const db = openControlDb(':memory:');
  const clock = { t: START };
  const auth = createAuth({ control: db, now: () => new Date(clock.t), participantRoles: () => [], admin });
  return { db, clock, auth };
}
const ttl = (s: { expiresAt: string }): number => Date.parse(s.expiresAt) - START;

describe('minimum password length', () => {
  it('is 10 and refuses shorter passwords', async () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    const { auth } = setup({ totp: false, rememberMs: REMEMBER_MS });
    await expect(auth.createAdmin('a@b.de', 'x'.repeat(9))).rejects.toThrow();
    await expect(auth.createAdmin('a@b.de', 'x'.repeat(10))).resolves.toBeTypeOf('string');
  });
});

describe('ADMIN_TOTP=off', () => {
  it('signs in with e-mail and password, ignoring any code, even from an account with a confirmed TOTP', async () => {
    const t = setup({ totp: false, rememberMs: REMEMBER_MS });
    const id = await t.auth.createAdmin('a@b.de', PASSWORD);
    expect(isAuthError(await t.auth.loginAdmin('a@b.de', PASSWORD, ''))).toBe(false);
    expect(await t.auth.loginAdmin('a@b.de', 'wrong password!', '')).toEqual({ code: 'invalid_login' });
    const key = base32Decode(t.auth.enrolTotp(id).secret);
    expect(t.auth.verifyTotp(id, totpAt(key, t.clock.t))).toBe(true);
    expect(isAuthError(await t.auth.loginAdmin('a@b.de', PASSWORD, '000000'))).toBe(false);
  });

  it('lasts 12 hours, or the remember days with "angemeldet bleiben"', async () => {
    const t = setup({ totp: false, rememberMs: REMEMBER_MS });
    await t.auth.createAdmin('a@b.de', PASSWORD);
    const short = await t.auth.loginAdmin('a@b.de', PASSWORD, '');
    const long = await t.auth.loginAdmin('a@b.de', PASSWORD, '', undefined, { remember: true });
    if (isAuthError(short) || isAuthError(long)) throw new Error('refused');
    expect(ttl(short)).toBe(SESSION_TTL_MS.admin);
    expect(ttl(short)).toBe(12 * 3600_000);
    expect(ttl(long)).toBe(REMEMBER_MS);
    t.clock.t += 13 * 3600_000;
    expect(t.auth.authenticate(short.id)).toBeNull();
    expect(t.auth.authenticate(long.id)).not.toBeNull();
  });
});

describe('ADMIN_TOTP=on', () => {
  it('an account without TOTP gets its otpauth URI on sign-in, then confirms with the first code and is in', async () => {
    const t = setup({ totp: true, rememberMs: REMEMBER_MS });
    const id = await t.auth.createAdmin('a@b.de', PASSWORD);
    const first = await t.auth.loginAdmin('a@b.de', PASSWORD, '');
    if (!isAuthError(first)) throw new Error('expected enrolment');
    expect(first.code).toBe('mfa_not_enrolled');
    const secret = new URL(first.otpauthUri ?? '').searchParams.get('secret') ?? '';
    expect(secret).not.toBe('');
    const key = base32Decode(secret);
    const session = await t.auth.loginAdmin('a@b.de', PASSWORD, totpAt(key, t.clock.t));
    if (isAuthError(session)) throw new Error(session.code);
    expect(t.auth.authenticate(session.id)).toMatchObject({ kind: 'admin', id });
    // from now on a blank code is refused and enrolment is not offered again
    t.clock.t += 30_000;
    expect(await t.auth.loginAdmin('a@b.de', PASSWORD, '')).toEqual({ code: 'invalid_login' });
  });

  it('a wrong password never reveals a secret; a wrong first code opens nothing', async () => {
    const t = setup({ totp: true, rememberMs: REMEMBER_MS });
    await t.auth.createAdmin('a@b.de', PASSWORD);
    expect(await t.auth.loginAdmin('a@b.de', 'wrong password!', '')).toEqual({ code: 'invalid_login' });
    const first = await t.auth.loginAdmin('a@b.de', PASSWORD, '');
    expect(isAuthError(first) && first.otpauthUri).toBeTruthy();
    expect(await t.auth.loginAdmin('a@b.de', PASSWORD, '123456')).toEqual({ code: 'invalid_login' });
  });

  it('remember applies to the TOTP sign-in too', async () => {
    const t = setup({ totp: true, rememberMs: REMEMBER_MS });
    const id = await t.auth.createAdmin('a@b.de', PASSWORD);
    const key = base32Decode(t.auth.enrolTotp(id).secret);
    expect(t.auth.verifyTotp(id, totpAt(key, t.clock.t))).toBe(true);
    t.clock.t += 30_000;
    const s = await t.auth.loginAdmin('a@b.de', PASSWORD, totpAt(key, t.clock.t), undefined, {
      remember: true,
    });
    if (isAuthError(s)) throw new Error(s.code);
    expect(Date.parse(s.expiresAt) - t.clock.t).toBe(REMEMBER_MS);
  });
});
