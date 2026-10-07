import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Key } from '@ueberblick/core';
import { openControlDb } from '../db/open';
import { createAuth } from './service';
import { base32Decode, base32Encode, hotp, totpAt } from './totp';
import { PASSWORD_PARAMS } from './params';
import { isAuthError } from './contract';

const START = Date.parse('2026-01-01T00:00:00.000Z');

function setup() {
  const db = openControlDb(':memory:');
  db.prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)').run(
    'p1',
    'trees',
    'Trees',
    'x',
  );
  const clock = { t: START };
  const roles = { current: ['kontrolleur' as Key] as readonly Key[] | null };
  const auth = createAuth({
    control: db,
    now: () => new Date(clock.t),
    participantRoles: () => roles.current,
  });
  return { db, clock, auth, roles };
}
type Setup = ReturnType<typeof setup>;
const dump = (db: Setup['db'], table: string): string =>
  JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());

function login(auth: Setup['auth'], user: string) {
  const s = auth.exchange(auth.issueCredential('p1', user).token);
  if (isAuthError(s)) throw new Error(s.code);
  return s;
}

async function adminWithTotp(t: Setup, email = 'a@b.de') {
  const id = await t.auth.createAdmin(email, 'pw-pw-pw-pw');
  const { secret } = t.auth.enrolTotp(id);
  const key = base32Decode(secret);
  expect(t.auth.verifyTotp(id, totpAt(key, t.clock.t))).toBe(true);
  t.clock.t += 30_000;
  return { id, key };
}

describe('QR credentials and sessions', () => {
  it('stores tokens readable and session ids only as hashes', () => {
    const { db, auth } = setup();
    const { token } = auth.issueCredential('p1', 'u1');
    const s = login(auth, 'u2');
    expect(dump(db, 'credentials')).toContain(token);
    expect(dump(db, 'sessions')).not.toContain(s.id);
    expect(db.prepare('SELECT id_hash FROM sessions').get()).toMatchObject({
      id_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('listCredentials shows state without the token', () => {
    const { db, auth } = setup();
    const { token } = auth.issueCredential('p1', 'u1', '2099-01-01T00:00:00.000Z');
    auth.issueCredential('p1', 'u2');
    db.prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)').run(
      'p2',
      'other',
      'O',
      'x',
    );
    auth.issueCredential('p2', 'u1');
    expect(auth.listCredentials('p1', 'u1')).toEqual([
      { participantId: 'u1', expiresAt: '2099-01-01T00:00:00.000Z', lastUsedAt: null, revokedAt: null },
    ]);
    expect(auth.listCredentials('p1').map((c) => c.participantId)).toEqual(['u1', 'u2']);
    auth.exchange(token);
    auth.revokeParticipant('p1', 'u2');
    const all = auth.listCredentials('p1');
    expect(all[0]?.lastUsedAt).not.toBeNull();
    expect(all[1]?.revokedAt).not.toBeNull();
    const text = JSON.stringify(all);
    expect(text).not.toContain(token);
    expect(Object.keys(all[0] ?? {}).sort()).toEqual([
      'expiresAt',
      'lastUsedAt',
      'participantId',
      'revokedAt',
    ]);
  });

  it('countActiveCredentials counts unrevoked, unexpired credentials per participant in one statement', () => {
    const { db, clock, auth } = setup();
    auth.issueCredential('p1', 'u1', '2099-01-01T00:00:00.000Z');
    auth.issueCredential('p1', 'u1');
    const used = auth.issueCredential('p1', 'u1');
    auth.issueCredential('p1', 'u2', '2026-01-01T01:00:00.000Z');
    auth.issueCredential('p1', 'u3');
    auth.exchange(used.token);
    auth.revokeParticipant('p1', 'u3');
    db.prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)').run('p2', 'o', 'O', 'x');
    auth.issueCredential('p2', 'u1');
    const at = new Date(clock.t + 2 * 3600 * 1000).toISOString();
    expect(auth.countActiveCredentials('p1', at)).toEqual(new Map([['u1', 3]]));
    expect(auth.countActiveCredentials('p1', new Date(clock.t).toISOString())).toEqual(
      new Map([
        ['u1', 3],
        ['u2', 1],
      ]),
    );
    const sql: string[] = [];
    const prepare = db.prepare.bind(db);
    db.prepare = ((q: string) => (sql.push(q), prepare(q))) as typeof db.prepare;
    auth.countActiveCredentials('p1', at);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/GROUP BY/i);
  });

  it('exchange yields a participant principal that maps onto an Actor', () => {
    const { auth } = setup();
    const p = auth.authenticate(login(auth, 'u1').id);
    if (!p) throw new Error('no principal');
    expect(p).toMatchObject({ kind: 'participant', id: 'u1', projectId: 'p1', roles: ['kontrolleur'] });
    expect(auth.toActor(p)).toEqual({ id: 'u1', kind: 'participant', roles: ['kontrolleur'] });
  });

  it('refuses unknown, revoked and expired credentials', () => {
    const { auth, clock } = setup();
    expect(auth.exchange('nope')).toEqual({ code: 'credential_unknown' });
    const a = auth.issueCredential('p1', 'u1');
    auth.revokeParticipant('p1', 'u1');
    expect(auth.exchange(a.token)).toEqual({ code: 'credential_revoked' });
    const b = auth.issueCredential('p1', 'u2', new Date(START + 1000).toISOString());
    clock.t += 2000;
    expect(auth.exchange(b.token)).toEqual({ code: 'credential_expired' });
  });

  it('refuses revoked and expired sessions; null for garbage', () => {
    const { auth, clock } = setup();
    const a = login(auth, 'u1');
    auth.revokeSession(a.id);
    expect(auth.authenticate(a.id)).toBeNull();
    const b = login(auth, 'u2');
    auth.revokeParticipant('p1', 'u2');
    expect(auth.authenticate(b.id)).toBeNull();
    const c = login(auth, 'u3');
    clock.t = Date.parse(c.expiresAt) + 1;
    expect(auth.authenticate(c.id)).toBeNull();
    expect(auth.authenticate('garbage')).toBeNull();
    expect(auth.authenticate('')).toBeNull();
  });

  it('authenticate stays valid over repeated lookups', () => {
    const { auth } = setup();
    const s = login(auth, 'u1');
    auth.authenticate(s.id);
    for (let i = 0; i < 2000; i++) auth.authenticate(s.id);
    expect(auth.authenticate(s.id)).toBeTruthy();
  });

  it("revokeParticipant ends only that participant's sessions in that project", () => {
    const { db, auth } = setup();
    db.prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)').run(
      'p2',
      'other',
      'Other',
      'x',
    );
    const a = login(auth, 'u1');
    const b = login(auth, 'u2');
    const s = auth.exchange(auth.issueCredential('p2', 'u1').token);
    if (isAuthError(s)) throw new Error(s.code);
    auth.revokeParticipant('p1', 'u1');
    expect(auth.authenticate(a.id)).toBeNull();
    expect(auth.authenticate(b.id)).not.toBeNull();
    expect(auth.authenticate(s.id)).not.toBeNull();
  });

  it('a credential of another project does not open a session there', () => {
    const { db, auth } = setup();
    db.prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)').run(
      'p2',
      'other',
      'Other',
      'x',
    );
    const s = auth.exchange(auth.issueCredential('p2', 'u1').token);
    if (isAuthError(s)) throw new Error(s.code);
    expect(auth.authenticate(s.id)?.projectId).toBe('p2');
    auth.revokeParticipant('p1', 'u1'); // other project: p2 credential unaffected
    expect(auth.authenticate(s.id)).not.toBeNull();
  });

  it('normalises expiresAt on store and rejects invalid dates', () => {
    const { db, auth, clock } = setup();
    auth.issueCredential('p1', 'u1', '2026-06-01T12:00:00+02:00');
    auth.issueCredential('p1', 'u2', '2026-06-01');
    const rows = db
      .prepare<{ expires_at: string }>('SELECT expires_at FROM credentials ORDER BY participant_id')
      .all()
      .map((r) => r.expires_at);
    expect(rows).toEqual(['2026-06-01T10:00:00.000Z', '2026-06-01T00:00:00.000Z']);
    expect(() => auth.issueCredential('p1', 'u3', 'not a date')).toThrow();
    const late = auth.issueCredential('p1', 'u4', '2026-01-01T02:00:00+02:00'); // = 00:00Z, at START
    clock.t += 1;
    expect(auth.exchange(late.token)).toEqual({ code: 'credential_expired' });
  });

  it('issueCredential refuses an unknown project', () => {
    expect(() => setup().auth.issueCredential('nope', 'u1')).toThrow();
  });
});

describe('admin accounts', () => {
  it('hashes passwords with scrypt and verifies them', async () => {
    const { db, auth } = setup();
    const id = await auth.createAdmin('a@b.de', 'correct horse');
    const row = db
      .prepare<{ password_hash: string }>('SELECT password_hash FROM accounts WHERE id = ?')
      .get(id);
    if (!row) throw new Error('no row');
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
    expect(row.password_hash).not.toContain('correct horse');
    expect(await auth.verifyPassword(id, 'correct horse')).toBe(true);
    expect(await auth.verifyPassword(id, 'wrong')).toBe(false);
    expect(await auth.verifyPassword('missing', 'x')).toBe(false);
  });

  it('uses a memory-hard KDF with parameters in one place', () => {
    expect(PASSWORD_PARAMS.n * PASSWORD_PARAMS.r * 128).toBeGreaterThanOrEqual(16 * 1024 * 1024);
    const dir = import.meta.dirname;
    const users = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .filter((f) => /scrypt/.test(readFileSync(join(dir, f), 'utf8')));
    expect(users.sort()).toEqual(['params.ts', 'password.ts']);
  });

  it('logs in with password + TOTP; refuses without enrolment, wrong password/code', async () => {
    const t = setup();
    const { auth, db, clock } = t;
    const id = await auth.createAdmin('a@b.de', 'pw-pw-pw-pw');
    db.prepare("INSERT INTO memberships VALUES (?, 'p1', 'owner')").run(id);
    expect(await auth.loginAdmin('a@b.de', 'pw-pw-pw-pw', '000000')).toEqual({ code: 'mfa_not_enrolled' });
    const { secret } = auth.enrolTotp(id);
    const key = base32Decode(secret);
    const code = totpAt(key, clock.t);
    expect(auth.verifyTotp(id, code)).toBe(true); // confirms enrolment
    expect(auth.verifyTotp(id, code)).toBe(false); // replay of the same step
    clock.t += 30_000;
    const next = totpAt(key, clock.t);
    expect(await auth.loginAdmin('a@b.de', 'bad', next)).toEqual({ code: 'invalid_login' });
    expect(await auth.loginAdmin('nobody@b.de', 'pw-pw-pw-pw', next)).toEqual({ code: 'invalid_login' });
    expect(await auth.loginAdmin('a@b.de', 'pw-pw-pw-pw', '123456')).toEqual({ code: 'invalid_login' });
    const s = await auth.loginAdmin('a@b.de', 'pw-pw-pw-pw', next);
    if (isAuthError(s)) throw new Error(s.code);
    expect(auth.authenticate(s.id)).toMatchObject({ kind: 'admin', id, projectId: null });
    expect(auth.rolesFor(id, 'p1')).toEqual(['owner']);
  });

  it('revokeAccountSessions logs the admin out everywhere', async () => {
    const t = setup();
    const { id, key } = await adminWithTotp(t);
    const s = await t.auth.loginAdmin('a@b.de', 'pw-pw-pw-pw', totpAt(key, t.clock.t));
    if (isAuthError(s)) throw new Error(s.code);
    expect(t.auth.authenticate(s.id)).not.toBeNull();
    t.auth.revokeAccountSessions(id);
    expect(t.auth.authenticate(s.id)).toBeNull();
  });
});

describe('TOTP reset', () => {
  it('enrolTotp refuses when confirmed; resetTotp replaces it and ends sessions', async () => {
    const t = setup();
    const { id, key } = await adminWithTotp(t);
    expect(() => t.auth.enrolTotp(id)).toThrow();
    const s = await t.auth.loginAdmin('a@b.de', 'pw-pw-pw-pw', totpAt(key, t.clock.t));
    if (isAuthError(s)) throw new Error(s.code);
    const fresh = t.auth.resetTotp(id);
    expect(t.auth.authenticate(s.id)).toBeNull();
    const k2 = base32Decode(fresh.secret);
    // the replacement is pending: a blank code asks for enrolment again, the first valid code confirms and signs in
    expect(await t.auth.loginAdmin('a@b.de', 'pw-pw-pw-pw', '000000')).toMatchObject({
      code: 'invalid_login',
    });
    const again = await t.auth.loginAdmin('a@b.de', 'pw-pw-pw-pw', totpAt(k2, t.clock.t));
    expect(isAuthError(again)).toBe(false); // lastStep was cleared
  });
});

describe('TOTP (RFC 6238)', () => {
  const key = new TextEncoder().encode('12345678901234567890');
  const vectors: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  it.each(vectors)('vector at T=%i', (t, code) => {
    expect(totpAt(key, t * 1000, { digits: 8 })).toBe(code);
  });
  it('HOTP RFC 4226 vector', () => {
    expect(hotp(key, 0, 6)).toBe('755224');
    expect(hotp(key, 9, 6)).toBe('520489');
  });
  it('base32 round-trips', () => {
    const b = new Uint8Array([1, 2, 3, 250, 251, 0, 9, 8, 7, 6]);
    expect(base32Decode(base32Encode(b))).toEqual(b);
  });
  it('accepts +-1 step, refuses +-2', async () => {
    const { auth, clock } = setup();
    const id = await auth.createAdmin('a@b.de', 'pw-pw-pw-pw');
    const k = base32Decode(auth.enrolTotp(id).secret);
    expect(auth.verifyTotp(id, totpAt(k, clock.t + 60_000))).toBe(false);
    expect(auth.verifyTotp(id, totpAt(k, clock.t - 60_000))).toBe(false);
    expect(auth.verifyTotp(id, totpAt(k, clock.t - 30_000))).toBe(true);
    expect(auth.verifyTotp(id, totpAt(k, clock.t + 30_000))).toBe(true);
  });
});

describe('timing-safe comparisons', () => {
  it('no source compares secrets, hashes or codes with == / ===', () => {
    const dir = import.meta.dirname;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.spec.ts'))) {
      const s = readFileSync(join(dir, f), 'utf8');
      expect(s, f).not.toMatch(/\b\w*(hash|token|secret|code|digest|password)\w*\s*[!=]==/i);
      expect(s, f).not.toMatch(/[!=]==\s*\w*(hash|token|secret|digest|password)\w*\b/i);
    }
    expect(readFileSync(join(dir, 'crypto.ts'), 'utf8')).toContain('timingSafeEqual');
  });
});

describe('participant roles port (WP-136)', () => {
  it('createAuth without participantRoles does not compile', () => {
    const db = openControlDb(':memory:');
    // @ts-expect-error participantRoles is required: no silent empty roles
    const attempt = () => createAuth({ control: db, now: () => new Date(START) });
    expect(typeof attempt).toBe('function');
  });

  it('a role change applies on the next authenticate; a disabled participant gets no session', () => {
    const t = setup();
    const s = login(t.auth, 'anna');
    expect(t.auth.authenticate(s.id)?.roles).toEqual(['kontrolleur']);
    t.roles.current = ['bauhof' as Key];
    expect(t.auth.authenticate(s.id)?.roles).toEqual(['bauhof']);
    t.roles.current = null; // disabled
    expect(t.auth.authenticate(s.id)).toBeNull();
  });

  it('a disabled participant cannot exchange a credential; the token works again once enabled', () => {
    const t = setup();
    const { token } = t.auth.issueCredential('p1', 'anna');
    t.roles.current = null;
    const refused = t.auth.exchange(token);
    expect(isAuthError(refused) && refused.code).toBe('participant_disabled');
    t.roles.current = ['kontrolleur' as Key];
    expect(isAuthError(t.auth.exchange(token))).toBe(false);
  });
});
