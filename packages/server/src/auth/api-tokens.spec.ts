import { describe, expect, it } from 'vitest';
import type { Key } from '@ueberblick/core';
import { openControlDb } from '../db/open';
import { readSessionCookie } from './cookie';
import { isAuthError } from './contract';
import { createAuth } from './service';

const START = Date.parse('2026-01-01T00:00:00.000Z');

function setup() {
  const db = openControlDb(':memory:');
  db.prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)').run('p1', 'p1', 'p1', 'x');
  const clock = { t: START };
  const roles = { current: ['kontrolle' as Key] as readonly Key[] | null };
  const auth = createAuth({
    control: db,
    now: () => new Date(clock.t),
    participantRoles: () => roles.current,
  });
  return { db, clock, auth, roles };
}
const issue = (a: ReturnType<typeof setup>['auth'], label = 'Laptop', exp?: string) => {
  const r = a.apiTokens.issue('p1', 'anna', { label, ...(exp ? { expiresAt: exp } : {}) });
  if (isAuthError(r)) throw new Error(r.code);
  return r;
};

describe('API tokens (A-037)', () => {
  it('issues a ubk_ token, shown once, stored only as a hash', () => {
    const { auth, db } = setup();
    const { token, info } = issue(auth);
    expect(token).toMatch(/^ubk_[A-Za-z0-9_-]{43}$/);
    expect(info.lastFour).toBe(token.slice(-4));
    const rows = JSON.stringify(db.prepare('SELECT * FROM api_tokens').all());
    expect(rows).not.toContain(token);
    expect(auth.apiTokens.list('p1')).toEqual([info]);
    expect(JSON.stringify(auth.apiTokens.list('p1'))).not.toContain(token);
  });

  it('authenticates as the participant with their live roles and records the last use', () => {
    const { auth, clock, roles } = setup();
    const { token } = issue(auth);
    const p = auth.authenticate(`api:${token}`);
    expect(p).toMatchObject({ kind: 'participant', id: 'anna', projectId: 'p1', roles: ['kontrolle'] });
    roles.current = ['verwaltung' as Key];
    expect(auth.authenticate(`api:${token}`)?.roles).toEqual(['verwaltung']);
    clock.t += 120_000;
    auth.authenticate(`api:${token}`);
    expect(auth.apiTokens.list('p1')[0]?.lastUsedAt).toBe(new Date(START + 120_000).toISOString());
  });

  it('stops after revoke, after expiry and for a disabled participant', () => {
    const { auth, clock, roles } = setup();
    const a = issue(auth, 'a');
    const b = issue(auth, 'b', new Date(START + 1000).toISOString());
    const c = issue(auth, 'c');
    expect(auth.apiTokens.revoke('p1', a.info.id)).toBe(true);
    expect(auth.authenticate(`api:${a.token}`)).toBeNull();
    expect(auth.apiTokens.list('p1').map((i) => i.label)).toEqual(['b', 'c']);
    clock.t += 2000;
    expect(auth.authenticate(`api:${b.token}`)).toBeNull();
    roles.current = null;
    expect(auth.authenticate(`api:${c.token}`)).toBeNull();
    expect(auth.apiTokens.revoke('p1', a.info.id)).toBe(false);
  });

  it('is not a login: exchange refuses it, and a session id never reads as a token', () => {
    const { auth } = setup();
    const { token } = issue(auth);
    expect(isAuthError(auth.exchange(token))).toBe(true);
    expect(auth.authenticate(token)).toBeNull();
    expect(auth.authenticate('api:ubk_nope')).toBeNull();
    expect(auth.authenticate('api:')).toBeNull();
  });

  it('refuses an unknown or disabled participant and an empty label; revokes only inside the project', () => {
    const { auth, roles } = setup();
    expect(auth.apiTokens.issue('p1', 'x', { label: '  ' })).toEqual({ code: 'token_invalid' });
    roles.current = null;
    expect(auth.apiTokens.issue('p1', 'x', { label: 'L' })).toEqual({ code: 'participant_disabled' });
    roles.current = ['k' as Key];
    const { info } = issue(auth);
    expect(auth.apiTokens.revoke('other', info.id)).toBe(false);
  });

  it('revoking a participant revokes their API tokens too', () => {
    const { auth } = setup();
    const { token } = issue(auth);
    auth.revokeParticipant('p1', 'anna');
    expect(auth.authenticate(`api:${token}`)).toBeNull();
  });
});

describe('admin API tokens (WP-1070)', () => {
  const adminSetup = async () => {
    const s = setup();
    s.db
      .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
      .run('p2', 'p2', 'p2', 'x');
    const accountId = await s.auth.createAdmin('chef@example.org', 'correct horse battery');
    const r = s.auth.apiTokens.issueAdmin('p1', accountId, { label: 'QGIS Admin' });
    if (isAuthError(r)) throw new Error(r.code);
    return { ...s, accountId, ...r };
  };

  it('authenticates as the admin principal, bound to the project, listed with the email', async () => {
    const { auth, token, info, accountId } = await adminSetup();
    expect(token).toMatch(/^ubk_/);
    expect(auth.authenticate(`api:${token}`)).toEqual({
      kind: 'admin',
      id: accountId,
      projectId: 'p1',
      roles: [],
    });
    expect(info).toMatchObject({ participantId: null, adminId: accountId, adminEmail: 'chef@example.org' });
    expect(auth.apiTokens.list('p1').map((i) => i.id)).toEqual([info.id]);
    expect(auth.apiTokens.list('p2')).toEqual([]);
    expect(isAuthError(auth.exchange(token))).toBe(true);
  });

  it('refuses an unknown account', () => {
    const { auth } = setup();
    expect(auth.apiTokens.issueAdmin('p1', 'nobody', { label: 'x' })).toEqual({
      code: 'participant_disabled',
    });
  });

  it('ends with revoke and when the admin account is revoked or deleted', async () => {
    const a = await adminSetup();
    expect(a.auth.apiTokens.revoke('p1', a.info.id)).toBe(true);
    expect(a.auth.authenticate(`api:${a.token}`)).toBeNull();
    const b = await adminSetup();
    b.auth.revokeAccountSessions(b.accountId);
    expect(b.auth.authenticate(`api:${b.token}`)).toBeNull();
    const c = await adminSetup();
    c.db.prepare('DELETE FROM accounts WHERE id = ?').run(c.accountId);
    expect(c.auth.authenticate(`api:${c.token}`)).toBeNull();
  });
});

describe('the credential of a request', () => {
  const req = (h: Record<string, string>) => new Request('http://x/', { headers: h });
  it('prefers the session cookie', () => {
    expect(
      readSessionCookie(
        req({ cookie: 'ub_session_participant=abc', authorization: 'Bearer ubk_t' }),
        'participant',
      ),
    ).toBe('abc');
  });
  it('reads an API token from Bearer or from the Basic user name (QGIS)', () => {
    expect(readSessionCookie(req({ authorization: 'Bearer ubk_tok' }), 'participant')).toBe('api:ubk_tok');
    const basic = `Basic ${Buffer.from('ubk_tok:').toString('base64')}`;
    expect(readSessionCookie(req({ authorization: basic }), 'participant')).toBe('api:ubk_tok');
    const asPassword = `Basic ${Buffer.from('user:ubk_tok').toString('base64')}`;
    expect(readSessionCookie(req({ authorization: asPassword }), 'participant')).toBe('api:ubk_tok');
  });
  it('gives an admin read no token: tokens are participant credentials', () => {
    expect(readSessionCookie(req({ authorization: 'Bearer ubk_tok' }), 'admin')).toBeNull();
  });
  it('ignores anything that is not a ubk_ token', () => {
    expect(readSessionCookie(req({ authorization: 'Bearer abc' }), 'participant')).toBeNull();
    expect(readSessionCookie(req({ authorization: 'Basic !!!' }), 'participant')).toBeNull();
    expect(readSessionCookie(req({}), 'participant')).toBeNull();
  });
});
