import { describe, expect, it } from 'vitest';
import type { Key } from '@ueberblick/core';
import { openControlDb } from '../db/open';
import { isAuthError, type AuthError } from './contract';
import { GENERATED_TOKEN, SESSION_TTL_MS, TOKEN_RULES } from './params';
import { createAuth } from './service';

const START = Date.parse('2026-01-01T00:00:00.000Z');
const DAY = 24 * 3600_000;

function setup() {
  const db = openControlDb(':memory:');
  for (const id of ['p1', 'p2'])
    db.prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)').run(id, id, id, 'x');
  const clock = { t: START };
  const roles = { current: ['kontrolleur' as Key] as readonly Key[] | null };
  const auth = createAuth({
    control: db,
    now: () => new Date(clock.t),
    participantRoles: () => roles.current,
  });
  return { db, clock, auth, roles };
}
const ok = <X extends object>(x: X): Exclude<X, AuthError> => {
  if (isAuthError(x)) throw new Error(x.code);
  return x as Exclude<X, AuthError>;
};

describe('reusable participant tokens', () => {
  it('the same token exchanges many times on different devices and updates last_used_at', () => {
    const { auth, clock, db } = setup();
    const { token } = auth.issueCredential('p1', 'u1');
    const a = ok(auth.exchange(token, 'phone'));
    clock.t += 1000;
    const b = ok(auth.exchange(token, 'tablet'));
    ok(auth.exchange(token, 'phone'));
    expect(a.id).not.toBe(b.id);
    expect(auth.authenticate(a.id)?.id).toBe('u1');
    expect(auth.authenticate(b.id)?.id).toBe('u1');
    expect(db.prepare('SELECT last_used_at FROM credentials').get()).toEqual({
      last_used_at: new Date(START + 1000).toISOString(),
    });
    expect(auth.listCredentials('p1')[0]?.lastUsedAt).toBe(new Date(START + 1000).toISOString());
  });

  it('stores generated tokens readable; they are typeable and long enough', () => {
    const { auth, db } = setup();
    const { token } = auth.issueCredential('p1', 'u1');
    expect(db.prepare('SELECT token FROM credentials').get()).toEqual({ token });
    expect(token).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){4}$/);
    expect(token.replace(/-/g, '')).toHaveLength(GENERATED_TOKEN.chars);
    // 32 symbols = 5 bits each, no modulo bias: 100 bits.
    expect(GENERATED_TOKEN.alphabet).toHaveLength(32);
    expect(new Set(Array.from({ length: 200 }, () => auth.issueCredential('p2', 'x').token)).size).toBe(200);
  });

  it('an admin-chosen token is stored and readable back', () => {
    const { auth, db } = setup();
    const r = ok(auth.issueChosenCredential('p1', 'u1', 'Rathaus-Team-7'));
    expect(r.token).toBe('Rathaus-Team-7');
    expect(db.prepare('SELECT token FROM credentials').get()).toEqual({ token: 'Rathaus-Team-7' });
    expect(ok(auth.exchange('Rathaus-Team-7')).principal.id).toBe('u1');
  });

  it('refuses a duplicate token across projects and participants, a short or odd one', () => {
    const { auth } = setup();
    ok(auth.issueChosenCredential('p1', 'u1', 'same-token-1'));
    expect(auth.issueChosenCredential('p2', 'u2', 'same-token-1')).toEqual({ code: 'token_duplicate' });
    expect(auth.issueChosenCredential('p1', 'u3', 'x'.repeat(TOKEN_RULES.minLength - 1))).toEqual({
      code: 'token_too_short',
    });
    expect(auth.issueChosenCredential('p1', 'u3', 'has space here')).toEqual({ code: 'token_invalid' });
    expect(auth.issueChosenCredential('p1', 'u3', 'a'.repeat(TOKEN_RULES.maxLength + 1))).toEqual({
      code: 'token_invalid',
    });
  });

  it('refuses revoked, expired and disabled-participant tokens with distinct codes', () => {
    const { auth, clock, roles } = setup();
    const a = auth.issueCredential('p1', 'u1');
    auth.revokeParticipant('p1', 'u1');
    expect(auth.exchange(a.token)).toEqual({ code: 'credential_revoked' });
    const b = auth.issueCredential('p1', 'u2', new Date(START + 1000).toISOString());
    clock.t += 2000;
    expect(auth.exchange(b.token)).toEqual({ code: 'credential_expired' });
    const c = auth.issueCredential('p1', 'u3');
    roles.current = null;
    expect(auth.exchange(c.token)).toEqual({ code: 'participant_disabled' });
    roles.current = ['kontrolleur' as Key];
    expect(isAuthError(auth.exchange(c.token))).toBe(false);
  });

  it('countActiveCredentials counts unrevoked, unexpired tokens even when used', () => {
    const { auth } = setup();
    const t = auth.issueCredential('p1', 'u1');
    auth.issueCredential('p1', 'u1');
    auth.exchange(t.token);
    expect(auth.countActiveCredentials('p1', new Date(START).toISOString()).get('u1')).toBe(2);
  });
});

describe('admin token view and replace (WP-607)', () => {
  it('currentCredential is null without a token and never crosses projects', () => {
    const { auth } = setup();
    expect(auth.currentCredential('p1', 'u1')).toBeNull();
    auth.issueCredential('p2', 'u1');
    expect(auth.currentCredential('p1', 'u1')).toBeNull();
    expect(auth.currentCredential('p2', 'u1')?.token).not.toBeNull();
  });

  it('currentCredential is the newest non-revoked token, and an expired one is still shown', () => {
    const { auth, db, clock } = setup();
    const a = auth.issueCredential('p1', 'u1');
    clock.t += DAY;
    const b = auth.issueCredential('p1', 'u1', new Date(START).toISOString());
    expect(auth.currentCredential('p1', 'u1')).toEqual({
      token: b.token,
      expiresAt: new Date(START).toISOString(),
      lastUsedAt: null,
    });
    db.prepare('UPDATE credentials SET revoked_at = ? WHERE token = ?').run(
      new Date(clock.t).toISOString(),
      b.token,
    );
    expect(auth.currentCredential('p1', 'u1')?.token).toBe(a.token);
    auth.revokeParticipant('p1', 'u1');
    expect(auth.currentCredential('p1', 'u1')).toBeNull();
  });

  it('replaceCredential issues a chosen token, revokes the earlier ones and keeps the sessions', () => {
    const { auth, db } = setup();
    const r1 = ok(auth.replaceCredential('p1', 'u1', 'first-token-1'));
    expect(r1).toEqual({ token: 'first-token-1', expiresAt: null, lastUsedAt: null });
    const session = ok(auth.exchange('first-token-1'));
    const future = new Date(START + 2 * DAY).toISOString();
    const r2 = ok(auth.replaceCredential('p1', 'u1', 'second-token-2', future));
    expect(r2).toEqual({ token: 'second-token-2', expiresAt: future, lastUsedAt: null });
    expect(auth.exchange('first-token-1')).toEqual({ code: 'credential_revoked' });
    expect(isAuthError(auth.exchange('second-token-2'))).toBe(false);
    // Sessions of the revoked token stay open.
    expect(auth.authenticate(session.id)?.id).toBe('u1');
    expect(db.prepare('SELECT count(*) AS n FROM credentials').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT count(*) AS n FROM credentials WHERE revoked_at IS NULL').get()).toEqual({
      n: 1,
    });
  });

  it('replaceCredential without a token generates one and replaces the current one', () => {
    const { auth } = setup();
    ok(auth.replaceCredential('p1', 'u1', 'first-token-1'));
    const r = ok(auth.replaceCredential('p1', 'u1'));
    expect(r.token).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){4}$/);
    expect(r.token).not.toBe('first-token-1');
    expect(auth.currentCredential('p1', 'u1')?.token).toBe(r.token);
    expect(auth.exchange('first-token-1')).toEqual({ code: 'credential_revoked' });
  });

  it('setting the current token again only updates its expiry and keeps last_used_at', () => {
    const { auth, clock, db } = setup();
    ok(auth.replaceCredential('p1', 'u1', 'same-token-1'));
    ok(auth.exchange('same-token-1')); // last_used_at = START
    clock.t += DAY;
    const future = new Date(START + 2 * DAY).toISOString();
    const r = ok(auth.replaceCredential('p1', 'u1', 'same-token-1', future));
    expect(r).toEqual({
      token: 'same-token-1',
      expiresAt: future,
      lastUsedAt: new Date(START).toISOString(),
    });
    // No new row: the single token is kept, only its expiry moved.
    expect(db.prepare('SELECT count(*) AS n FROM credentials').get()).toEqual({ n: 1 });
    expect(isAuthError(auth.exchange('same-token-1'))).toBe(false);
  });

  it('refuses a duplicate, short or invalid token and changes nothing', () => {
    const { auth, db } = setup();
    ok(auth.replaceCredential('p1', 'u1', 'shared-token-1'));
    expect(auth.replaceCredential('p2', 'u9', 'shared-token-1')).toEqual({ code: 'token_duplicate' });
    expect(auth.replaceCredential('p1', 'u1', 'x'.repeat(TOKEN_RULES.minLength - 1))).toEqual({
      code: 'token_too_short',
    });
    expect(auth.replaceCredential('p1', 'u1', 'has space here')).toEqual({ code: 'token_invalid' });
    expect(auth.replaceCredential('p1', 'u1', 'a'.repeat(TOKEN_RULES.maxLength + 1))).toEqual({
      code: 'token_invalid',
    });
    // A revoked old token is still a duplicate: tokens are unique instance-wide.
    ok(auth.replaceCredential('p1', 'u1', 'new-token-9'));
    expect(auth.replaceCredential('p1', 'u1', 'shared-token-1')).toEqual({ code: 'token_duplicate' });
    // Nothing changed: 'new-token-9' is still current and no row was added.
    expect(auth.currentCredential('p1', 'u1')?.token).toBe('new-token-9');
    expect(db.prepare('SELECT count(*) AS n FROM credentials').get()).toEqual({ n: 2 });
  });

  it('throws for an unknown project', () => {
    const { auth } = setup();
    expect(() => auth.replaceCredential('nope', 'u1', 'some-token-1')).toThrow();
    expect(auth.currentCredential('nope', 'u1')).toBeNull();
  });
});

describe('sliding participant session', () => {
  it('lasts 90 days', () => {
    expect(SESSION_TTL_MS.participant).toBe(90 * DAY);
    const { auth } = setup();
    const s = ok(auth.exchange(auth.issueCredential('p1', 'u1').token));
    expect(Date.parse(s.expiresAt)).toBe(START + 90 * DAY);
  });

  it('does not write inside 24 h of the last renewal, renews after it', () => {
    const { auth, clock, db } = setup();
    const s = ok(auth.exchange(auth.issueCredential('p1', 'u1').token));
    const expiry = (): string =>
      (db.prepare<{ expires_at: string }>('SELECT expires_at FROM sessions').get() as { expires_at: string })
        .expires_at;
    const before = expiry();
    clock.t += DAY - 1;
    expect(auth.authenticate(s.id)?.renewedExpiresAt).toBeUndefined();
    expect(expiry()).toBe(before);
    clock.t += 1; // exactly 24 h
    expect(auth.authenticate(s.id)?.renewedExpiresAt).toBe(START + DAY + 90 * DAY);
    expect(expiry()).toBe(new Date(START + DAY + 90 * DAY).toISOString());
    clock.t += 1000;
    const again = auth.authenticate(s.id);
    expect(again).not.toBeNull();
    expect(again?.renewedExpiresAt).toBeUndefined(); // throttled again
  });

  it('sessionExpiry tells when the session ends, and null once it is over or unknown', () => {
    const { auth, clock } = setup();
    const s = ok(auth.exchange(auth.issueCredential('p1', 'u1').token));
    expect(auth.sessionExpiry(s.id)).toBe(s.expiresAt);
    expect(auth.sessionExpiry('nope')).toBeNull();
    expect(auth.sessionExpiry(null)).toBeNull();
    clock.t += 91 * DAY;
    expect(auth.sessionExpiry(s.id)).toBeNull();
  });

  it('a worker who comes online once a quarter stays signed in; 91 idle days do not', () => {
    const { auth, clock } = setup();
    const s = ok(auth.exchange(auth.issueCredential('p1', 'u1').token));
    clock.t += 80 * DAY;
    expect(auth.authenticate(s.id)).not.toBeNull();
    clock.t += 80 * DAY;
    expect(auth.authenticate(s.id)).not.toBeNull();
    clock.t += 91 * DAY;
    expect(auth.authenticate(s.id)).toBeNull();
  });

  it('admin sessions do not slide', async () => {
    const { auth, clock } = setup();
    const id = await auth.createAdmin('a@b.de', 'pw-pw-pw-pw');
    const s = auth.openAdminSession(id);
    clock.t += 6 * 3600_000;
    expect(auth.authenticate(s.id)?.renewedExpiresAt).toBeUndefined();
    clock.t += 7 * 3600_000;
    expect(auth.authenticate(s.id)).toBeNull(); // 12 h from the open, never renewed
  });

  it('a disabled participant session is refused on the next authenticate, with no renewal write', () => {
    const { auth, clock, roles, db } = setup();
    const s = ok(auth.exchange(auth.issueCredential('p1', 'u1').token));
    const before = db.prepare('SELECT expires_at FROM sessions').get();
    clock.t += 2 * DAY;
    roles.current = null;
    expect(auth.authenticate(s.id)).toBeNull();
    expect(db.prepare('SELECT expires_at FROM sessions').get()).toEqual(before);
  });

  it('revokeSession ends one session only', () => {
    const { auth } = setup();
    const { token } = auth.issueCredential('p1', 'u1');
    const a = ok(auth.exchange(token));
    const b = ok(auth.exchange(token));
    auth.revokeSession(a.id);
    expect(auth.authenticate(a.id)).toBeNull();
    expect(auth.authenticate(b.id)).not.toBeNull();
  });
});
