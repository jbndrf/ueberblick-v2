import { createHash, randomUUID } from 'node:crypto';
import type { Db } from '../../db/driver';
import type { Auth, Session } from '../contract';
import { randomToken } from '../crypto';
import type {
  CallbackParams,
  LoginStart,
  Oidc,
  OidcError,
  OidcProvider,
  OidcStateStore,
  PendingLogin,
} from './contract';
import { createKeySource, type OidcFetch } from './jwks';
import { checkClaims, parseJwt, verifySignature } from './jwt';
import { OIDC_PARAMS } from './params';
import { OIDC_ALGORITHMS } from './registry';

export interface OidcDeps {
  readonly auth: Auth;
  readonly control: Db;
  readonly providers: readonly OidcProvider[];
  readonly fetch: OidcFetch;
  /** Reads an environment variable by name (the client secret reference). */
  readonly env: (name: string) => string | undefined;
  /** The only clock. */
  readonly now: () => Date;
  /** Default: in memory, single process. */
  readonly store?: OidcStateStore;
}

const err = (code: OidcError['code']): OidcError => ({ code });

export function memoryStateStore(now: () => Date): OidcStateStore & { size(): number } {
  const map = new Map<string, PendingLogin>();
  return {
    put(state, pending) {
      const t = now().getTime();
      if (map.size >= OIDC_PARAMS.maxPending) for (const [k, v] of map) if (v.expiresAt <= t) map.delete(k);
      if (map.size >= OIDC_PARAMS.maxPending) return false;
      map.set(state, pending);
      return true;
    },
    take(state) {
      const hit = map.get(state) ?? null;
      map.delete(state);
      return hit;
    },
    size: () => map.size,
  };
}

/** `accounts.oidc_sub` holds `<issuer>#<sub>`: a subject is only unique per issuer. */
const linkValue = (issuer: string, sub: string): string => `${issuer}#${sub}`;

function claimMatches(claims: Readonly<Record<string, unknown>>, claim: string, value: string): boolean {
  const v = claims[claim];
  return v === value || (Array.isArray(v) && v.includes(value));
}

export function createOidc(deps: OidcDeps): Oidc {
  const { control: db } = deps;
  const store = deps.store ?? memoryStateStore(deps.now);
  const keys = createKeySource({ fetch: deps.fetch, now: () => deps.now().getTime() });
  const byKey = new Map(deps.providers.map((p) => [p.key, p]));

  function resolveAccount(
    p: OidcProvider,
    sub: string,
    claims: Readonly<Record<string, unknown>>,
  ): string | null {
    const link = linkValue(p.issuer, sub);
    const find = (): string | null =>
      db.prepare<{ id: string }>('SELECT id FROM accounts WHERE oidc_sub = ?').get(link)?.id ?? null;
    const existing = find();
    if (existing) return existing;
    if (!p.provision || !claimMatches(claims, p.provision.claim, p.provision.value)) return null;
    const email = claims[p.emailClaim ?? 'email'];
    try {
      db.prepare('INSERT INTO accounts (id, email, oidc_sub) VALUES (?,?,?)').run(
        randomUUID(),
        typeof email === 'string' ? email.trim().toLowerCase() : null,
        link,
      );
    } catch {
      // A concurrent first login created it, or the email belongs to another account (never linked by email).
      return find();
    }
    return find();
  }

  async function exchange(
    p: OidcProvider,
    code: string,
    verifier: string,
    tokenUrl: string,
  ): Promise<string | null> {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: p.redirectUri,
      client_id: p.clientId,
      code_verifier: verifier,
    });
    if (p.clientSecretEnv) form.set('client_secret', deps.env(p.clientSecretEnv) ?? '');
    try {
      const res = await deps.fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: form.toString(),
      });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      const token = (body as { id_token?: unknown } | null)?.id_token;
      return typeof token === 'string' ? token : null;
    } catch {
      return null;
    }
  }

  return {
    async beginLogin(providerKey): Promise<LoginStart | OidcError> {
      const p = byKey.get(providerKey);
      if (!p) return err('provider_unknown');
      const ep = await keys.endpoints(p.issuer);
      if (!ep) return err('provider_error');
      const state = randomToken(OIDC_PARAMS.stateBytes);
      const nonce = randomToken(OIDC_PARAMS.nonceBytes);
      const verifier = randomToken(OIDC_PARAMS.verifierBytes);
      const stored = store.put(state, {
        providerKey,
        nonce,
        verifier,
        expiresAt: deps.now().getTime() + OIDC_PARAMS.stateTtlMs,
      });
      if (!stored) return err('too_many_pending');
      const q = new URLSearchParams({
        response_type: 'code',
        client_id: p.clientId,
        redirect_uri: p.redirectUri,
        scope: ['openid', ...(p.scopes ?? ['email']).filter((s) => s !== 'openid')].join(' '),
        state,
        nonce,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      });
      return {
        redirectUrl: `${ep.authorization}${ep.authorization.includes('?') ? '&' : '?'}${q.toString()}`,
        state,
      };
    },

    async completeLogin(params: CallbackParams, device?: string): Promise<Session | OidcError> {
      // The state is consumed first, whatever happens next: a callback can never be replayed.
      const pending = params.state ? store.take(params.state) : null;
      if (!pending || pending.expiresAt <= deps.now().getTime()) return err('state_unknown');
      const p = byKey.get(pending.providerKey);
      if (!p) return err('provider_unknown');
      if (params.error || !params.code) return err('provider_error');
      if (p.clientSecretEnv && !deps.env(p.clientSecretEnv)) return err('provider_error');
      const ep = await keys.endpoints(p.issuer);
      if (!ep) return err('provider_error');
      const idToken = await exchange(p, params.code, pending.verifier, ep.token);
      if (!idToken) return err('token_exchange_failed');

      const jwt = parseJwt(idToken, p.algorithms ?? OIDC_ALGORITHMS.keys);
      if (!jwt) return err('id_token_invalid');
      const jwk = await keys.key(p.issuer, jwt.kid, jwt.alg);
      if (!jwk || !verifySignature(jwt, jwk)) return err('id_token_invalid');
      const sub = checkClaims(jwt.claims, {
        issuer: p.issuer,
        clientId: p.clientId,
        nonce: pending.nonce,
        now: deps.now().getTime(),
        skewSeconds: OIDC_PARAMS.clockSkewSeconds,
      });
      if (!sub) return err('id_token_invalid');

      const accountId = resolveAccount(p, sub, jwt.claims);
      if (!accountId) return err('subject_not_linked');
      return deps.auth.openAdminSession(accountId, device);
    },

    linkSubject(accountId, providerKey, subject) {
      const p = byKey.get(providerKey);
      if (!p) throw new Error(`unknown provider: ${providerKey}`);
      const res = db
        .prepare('UPDATE accounts SET oidc_sub = ? WHERE id = ?')
        .run(linkValue(p.issuer, subject), accountId);
      if (res.changes === 0) throw new Error('unknown account');
    },
  };
}
