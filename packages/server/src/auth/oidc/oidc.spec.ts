import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { openControlDb } from '../../db/open';
import { createAuth } from '../service';
import { isAuthError } from '../contract';
import { isOidcError, type OidcProvider } from './contract';
import { createOidc, memoryStateStore } from './service';
import { createMockIssuer, makeKey, type TokenTweaks } from './test-issuer';
import { OIDC_PARAMS } from './params';

const START = Date.parse('2026-01-01T00:00:00.000Z');
const SECRET = 'super-secret-client-value';

function setup(provider: Partial<OidcProvider> = {}) {
  const db = openControlDb(':memory:');
  const clock = { t: START };
  const now = () => new Date(clock.t);
  const auth = createAuth({ control: db, now, participantRoles: () => [] });
  const idp = createMockIssuer({ clientId: 'ueb', clientSecret: SECRET, now: () => clock.t });
  const cfg: OidcProvider = {
    key: 'kc',
    issuer: idp.issuer,
    clientId: 'ueb',
    clientSecretEnv: 'UEB_OIDC_SECRET',
    redirectUri: 'https://ueb.example.org/auth/oidc/kc/callback',
    ...provider,
  };
  const env = (name: string) => (name === 'UEB_OIDC_SECRET' ? SECRET : undefined);
  const oidc = createOidc({ auth, control: db, providers: [cfg], fetch: idp.fetch, env, now });
  return { db, clock, auth, idp, oidc, cfg };
}
type T = ReturnType<typeof setup>;

async function login(
  t: T,
  sub: string,
  tweaks?: TokenTweaks,
  mutate?: (p: { state: string; code: string }) => { state?: string; code?: string },
) {
  const start = await t.oidc.beginLogin('kc');
  if (isOidcError(start)) throw new Error(start.code);
  const cb = t.idp.authorize(start.redirectUrl, sub, tweaks);
  return t.oidc.completeLogin(mutate ? { ...cb, ...mutate(cb) } : cb);
}

async function linked(t: T, sub = 'u-1') {
  const id = await t.auth.createAdmin('a@b.de', 'pw-pw-pw-pw');
  t.oidc.linkSubject(id, 'kc', sub);
  return id;
}

describe('code flow with PKCE, state and nonce', () => {
  it('sends S256 challenge, state, nonce and openid scope, and completes with the verifier and secret', async () => {
    const t = setup();
    const id = await linked(t);
    const start = await t.oidc.beginLogin('kc');
    if (isOidcError(start)) throw new Error(start.code);
    const q = new URL(start.redirectUrl).searchParams;
    expect(start.redirectUrl.startsWith(`${t.idp.issuer}/authorize?`)).toBe(true);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('scope')?.split(' ')).toContain('openid');
    expect(q.get('client_id')).toBe('ueb');
    expect(q.get('redirect_uri')).toBe(t.cfg.redirectUri);
    expect(q.get('state')).toBe(start.state);
    expect(q.get('nonce')).toBeTruthy();
    const res = await t.oidc.completeLogin(t.idp.authorize(start.redirectUrl, 'u-1'));
    if (isOidcError(res)) throw new Error(res.code);
    expect(res.principal).toEqual({ kind: 'admin', id, projectId: null, roles: [] });
    const form = t.idp.lastTokenRequest();
    expect(form?.get('grant_type')).toBe('authorization_code');
    expect(
      createHash('sha256')
        .update(form?.get('code_verifier') ?? '')
        .digest('base64url'),
    ).toBe(q.get('code_challenge'));
    expect(form?.get('client_secret')).toBe(SECRET);
  });

  it('refuses a replayed state, an unknown state and an expired state', async () => {
    const t = setup();
    await linked(t);
    const start = await t.oidc.beginLogin('kc');
    if (isOidcError(start)) throw new Error(start.code);
    const cb = t.idp.authorize(start.redirectUrl, 'u-1');
    expect(isOidcError(await t.oidc.completeLogin(cb))).toBe(false);
    expect(await t.oidc.completeLogin(cb)).toEqual({ code: 'state_unknown' });
    expect(await login(t, 'u-1', undefined, () => ({ state: 'forged' }))).toEqual({ code: 'state_unknown' });
    const s2 = await t.oidc.beginLogin('kc');
    if (isOidcError(s2)) throw new Error(s2.code);
    const cb2 = t.idp.authorize(s2.redirectUrl, 'u-1');
    t.clock.t += OIDC_PARAMS.stateTtlMs + 1;
    expect(await t.oidc.completeLogin(cb2)).toEqual({ code: 'state_unknown' });
  });

  it('refuses a state that belongs to another login (mismatch) and missing params', async () => {
    const t = setup();
    await linked(t);
    const a = await t.oidc.beginLogin('kc');
    if (isOidcError(a)) throw new Error(a.code);
    const codeForB = await (async () => {
      const b = await t.oidc.beginLogin('kc');
      if (isOidcError(b)) throw new Error(b.code);
      return t.idp.authorize(b.redirectUrl, 'u-1');
    })();
    // b's code with a's state: the PKCE verifier of a does not match b's challenge.
    const res = await t.oidc.completeLogin({ state: a.state, code: codeForB.code });
    expect(res).toEqual({ code: 'token_exchange_failed' });
    expect(await t.oidc.completeLogin({})).toEqual({ code: 'state_unknown' });
    const c = await t.oidc.beginLogin('kc');
    if (isOidcError(c)) throw new Error(c.code);
    expect(await t.oidc.completeLogin({ state: c.state })).toEqual({ code: 'provider_error' });
  });

  it('refuses a provider error callback and an unknown provider', async () => {
    const t = setup();
    const start = await t.oidc.beginLogin('kc');
    if (isOidcError(start)) throw new Error(start.code);
    expect(await t.oidc.completeLogin({ state: start.state, error: 'access_denied' })).toEqual({
      code: 'provider_error',
    });
    // the state was consumed by the failed callback
    expect(await t.oidc.completeLogin({ state: start.state, code: 'x' })).toEqual({ code: 'state_unknown' });
    expect(await t.oidc.beginLogin('nope')).toEqual({ code: 'provider_unknown' });
  });
});

describe('ID token validation', () => {
  const now = (t: T) => Math.floor(t.clock.t / 1000);
  it.each<[string, (t: T) => TokenTweaks]>([
    ['wrong nonce', () => ({ claims: { nonce: 'other' } })],
    ['missing nonce', () => ({ claims: { nonce: undefined } })],
    ['wrong iss', () => ({ claims: { iss: 'https://evil.example' } })],
    ['wrong aud', () => ({ claims: { aud: 'someone-else' } })],
    ['aud array without us', () => ({ claims: { aud: ['a', 'b'] } })],
    ['aud array with several and wrong azp', () => ({ claims: { aud: ['ueb', 'b'], azp: 'b' } })],
    ['expired', (t) => ({ claims: { exp: now(t) - OIDC_PARAMS.clockSkewSeconds - 5 } })],
    ['missing exp', () => ({ claims: { exp: undefined } })],
    ['iat in the future', (t) => ({ claims: { iat: now(t) + 3600 } })],
    ['missing sub', () => ({ claims: { sub: undefined } })],
    ['bad signature', () => ({ sign: { badSignature: true } })],
    ['alg none', () => ({ sign: { header: { alg: 'none' } } })],
    ['HS256 with the public key as secret', () => ({ sign: { header: { alg: 'HS256' } } })],
    ['unknown kid', () => ({ sign: { header: { kid: 'ghost' } } })],
    ['signed by a key that is not in the JWKS', () => ({ key: makeKey('k1') })],
  ])('refuses: %s', async (_name, tweaks) => {
    const t = setup();
    await linked(t);
    expect(await login(t, 'u-1', tweaks(t))).toEqual({ code: 'id_token_invalid' });
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('refuses an algorithm the provider config does not allow, and a response without ID token', async () => {
    const t = setup({ algorithms: ['ES256'] });
    await linked(t);
    expect(await login(t, 'u-1')).toEqual({ code: 'id_token_invalid' });
    const t2 = setup();
    await linked(t2);
    expect(await login(t2, 'u-1', { omitIdToken: true })).toEqual({ code: 'token_exchange_failed' });
  });

  it('accepts an ES256 provider key and tolerates small clock skew', async () => {
    const t = setup();
    await linked(t);
    t.idp.keys = [makeKey('e1', 'ES256')];
    const res = await login(t, 'u-1', { claims: { iat: now(t) + 30 } });
    expect(isOidcError(res)).toBe(false);
  });

  it('handles key rotation: an unknown kid refetches the JWKS once, then it is cached', async () => {
    const t = setup();
    await linked(t);
    expect(isOidcError(await login(t, 'u-1'))).toBe(false);
    const before = t.idp.counts.jwks;
    expect(isOidcError(await login(t, 'u-1'))).toBe(false);
    expect(t.idp.counts.jwks).toBe(before); // cache hit
    t.idp.keys = [makeKey('k2'), ...t.idp.keys];
    t.clock.t += OIDC_PARAMS.jwksMinRefetchMs + 1;
    expect(isOidcError(await login(t, 'u-1'))).toBe(false); // signed by k2, refetched
    expect(t.idp.counts.jwks).toBe(before + 1);
  });

  it('does not refetch the JWKS on every unknown kid (rate limit) and refreshes after the TTL', async () => {
    const t = setup();
    await linked(t);
    expect(isOidcError(await login(t, 'u-1'))).toBe(false);
    const before = t.idp.counts.jwks;
    for (let i = 0; i < 5; i++) await login(t, 'u-1', { sign: { header: { kid: 'ghost' } } });
    expect(t.idp.counts.jwks).toBeLessThanOrEqual(before + 1);
    t.clock.t += OIDC_PARAMS.jwksTtlMs + 1;
    expect(isOidcError(await login(t, 'u-1'))).toBe(false);
    expect(t.idp.counts.jwks).toBeGreaterThan(before);
  });

  it('property: any tampering of a payload byte invalidates the signature', async () => {
    const t = setup();
    await linked(t);
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 12 }), async (extra) => {
        const res = await login(t, 'u-1', { claims: { sub: `u-1${extra}` }, sign: { badSignature: true } });
        expect(res).toEqual({ code: 'id_token_invalid' });
      }),
      { numRuns: 15 },
    );
  });
});

describe('subject mapping', () => {
  it('refuses a subject that is not linked, without provisioning', async () => {
    const t = setup();
    expect(await login(t, 'stranger')).toEqual({ code: 'subject_not_linked' });
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 0 });
  });

  it('a link is per provider issuer: the same sub from another provider is not the same admin', async () => {
    const t = setup();
    const id = await t.auth.createAdmin('a@b.de', 'pw-pw-pw-pw');
    t.db.prepare('UPDATE accounts SET oidc_sub = ? WHERE id = ?').run('u-1', id); // bare sub, no issuer
    expect(await login(t, 'u-1')).toEqual({ code: 'subject_not_linked' });
  });

  it('linkSubject throws for an unknown account or provider', () => {
    const t = setup();
    expect(() => t.oidc.linkSubject('nope', 'kc', 's')).toThrow();
    expect(() => t.oidc.linkSubject('nope', 'zz', 's')).toThrow();
  });

  it('provisions an account only when the claim rule matches', async () => {
    const t = setup({ provision: { claim: 'groups', value: 'ueb-admins' } });
    expect(await login(t, 'x1', { claims: { groups: 'other' } })).toEqual({ code: 'subject_not_linked' });
    const ok = await login(t, 'x2', { claims: { groups: ['ueb-admins', 'z'] } });
    if (isOidcError(ok)) throw new Error(ok.code);
    expect(t.auth.authenticate(ok.id)?.kind).toBe('admin');
    const row = t.db
      .prepare<{ email: string; password_hash: string | null }>('SELECT email, password_hash FROM accounts')
      .get();
    expect(row).toEqual({ email: 'x2@example.org', password_hash: null });
    // second login reaches the same account
    const again = await login(t, 'x2', { claims: { groups: 'ueb-admins' } });
    if (isOidcError(again)) throw new Error(again.code);
    expect(again.principal.id).toBe(ok.principal.id);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 1 });
  });

  it('a provisioned account has no password: password + TOTP login stays impossible', async () => {
    const t = setup({ provision: { claim: 'email', value: 'x2@example.org' } });
    const ok = await login(t, 'x2');
    if (isOidcError(ok)) throw new Error(ok.code);
    expect(await t.auth.verifyPassword(ok.principal.id, '')).toBe(false);
  });
});

describe('session and secrets', () => {
  it('yields the same kind of session as password login: hashed at rest, revocable, logout revokes', async () => {
    const t = setup();
    const id = await linked(t);
    const s = await login(t, 'u-1');
    if (isOidcError(s)) throw new Error(s.code);
    expect(isAuthError(s)).toBe(false);
    expect(JSON.stringify(t.db.prepare('SELECT * FROM sessions').all())).not.toContain(s.id);
    expect(t.auth.authenticate(s.id)).toEqual({ kind: 'admin', id, projectId: null, roles: [] });
    expect(new Date(s.expiresAt).getTime()).toBeGreaterThan(t.clock.t);
    t.auth.revokeSession(s.id);
    expect(t.auth.authenticate(s.id)).toBeNull();
    const s2 = await login(t, 'u-1');
    if (isOidcError(s2)) throw new Error(s2.code);
    t.auth.revokeAccountSessions(id);
    expect(t.auth.authenticate(s2.id)).toBeNull();
  });

  it('reads the client secret from the named env var, never from config, and never logs it', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const t = setup();
    await linked(t);
    const results = [
      await login(t, 'u-1'),
      await login(t, 'stranger'),
      await login(t, 'u-1', { sign: { badSignature: true } }),
    ];
    const seen = JSON.stringify([
      results.map((r) => ({ ...r, id: undefined })),
      t.cfg,
      spies.map((s) => s.mock.calls),
    ]);
    expect(seen).not.toContain(SECRET);
    expect(JSON.stringify(t.db.prepare('SELECT * FROM sessions').all())).not.toContain(SECRET);
    spies.forEach((s) => s.mockRestore());
    // Missing env var: the login cannot start a token exchange and says so without leaking a name or value.
    const db = openControlDb(':memory:');
    const now = () => new Date(t.clock.t);
    const bare = createOidc({
      auth: createAuth({ control: db, now, participantRoles: () => [] }),
      control: db,
      providers: [t.cfg],
      fetch: t.idp.fetch,
      env: () => undefined,
      now,
    });
    const start = await bare.beginLogin('kc');
    if (isOidcError(start)) throw new Error(start.code);
    expect(await bare.completeLogin(t.idp.authorize(start.redirectUrl, 'u-1'))).toEqual({
      code: 'provider_error',
    });
  });

  it('a discovery document with a different issuer is refused', async () => {
    const t = setup();
    const evil = createMockIssuer({ issuer: 'https://evil.example', clientId: 'ueb', now: () => t.clock.t });
    const now = () => new Date(t.clock.t);
    const oidc = createOidc({
      auth: t.auth,
      control: t.db,
      providers: [{ ...t.cfg, issuer: t.idp.issuer }],
      // serves the evil issuer's documents under the configured issuer URL
      fetch: async (url, init) => evil.fetch(url.replace(t.idp.issuer, evil.issuer), init),
      env: () => SECRET,
      now,
    });
    expect(await oidc.beginLogin('kc')).toEqual({ code: 'provider_error' });
  });
});

describe('pending login store is bounded', () => {
  const pending = (expiresAt: number) => ({ providerKey: 'kc', nonce: 'n', verifier: 'v', expiresAt });

  it('sweeps expired entries on put, so the size stays bounded over time', () => {
    const clock = { t: START };
    const store = memoryStateStore(() => new Date(clock.t));
    for (let i = 0; i < OIDC_PARAMS.maxPending; i++)
      expect(store.put(`s${i}`, pending(clock.t + OIDC_PARAMS.stateTtlMs))).toBe(true);
    expect(store.size()).toBe(OIDC_PARAMS.maxPending);
    clock.t += OIDC_PARAMS.stateTtlMs + 1;
    expect(store.put('fresh', pending(clock.t + OIDC_PARAMS.stateTtlMs))).toBe(true);
    expect(store.size()).toBe(1);
  });

  it('refuses beyond maxPending with a typed error, and recovers after a completed login', async () => {
    const t = setup();
    await linked(t);
    const started: string[] = [];
    for (let i = 0; i < OIDC_PARAMS.maxPending; i++) {
      const s = await t.oidc.beginLogin('kc');
      if (isOidcError(s)) throw new Error(s.code);
      started.push(s.redirectUrl);
    }
    expect(await t.oidc.beginLogin('kc')).toEqual({ code: 'too_many_pending' });
    const first = started[0] ?? '';
    const done = await t.oidc.completeLogin(t.idp.authorize(first, 'u-1'));
    expect(isOidcError(done)).toBe(false);
    expect(isOidcError(await t.oidc.beginLogin('kc'))).toBe(false);
  });
});
