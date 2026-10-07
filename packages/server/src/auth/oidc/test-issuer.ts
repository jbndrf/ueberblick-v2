/** In-process mock OpenID provider with its own JWKS. Test support only: it is never imported by production code. */
import { createHash, createHmac, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { OidcFetch } from './jwks';

export interface IssuerKey {
  readonly kid: string;
  readonly alg: 'RS256' | 'ES256';
  readonly privateKey: KeyObject;
  readonly jwk: Record<string, unknown>;
}

export function makeKey(kid: string, alg: IssuerKey['alg'] = 'RS256'): IssuerKey {
  const pair =
    alg === 'RS256'
      ? generateKeyPairSync('rsa', { modulusLength: 2048 })
      : generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg };
  return { kid, alg, privateKey: pair.privateKey, jwk };
}

const b64 = (o: object | Buffer): string =>
  (Buffer.isBuffer(o) ? o : Buffer.from(JSON.stringify(o))).toString('base64url');

export interface SignOptions {
  readonly header?: Record<string, unknown>;
  /** Replace the signature with this many zero bytes' worth of garbage. */
  readonly badSignature?: boolean;
}

/** Signs with the key's own algorithm unless `header.alg` says otherwise (`none`, `HS256` with a public key as secret). */
export function signJwt(key: IssuerKey, claims: Record<string, unknown>, opts: SignOptions = {}): string {
  const header: Record<string, unknown> = { alg: key.alg, kid: key.kid, typ: 'JWT', ...opts.header };
  const data = `${b64(header)}.${b64(claims)}`;
  let sig: Buffer;
  if (header.alg === 'none') sig = Buffer.alloc(0);
  else if (header.alg === 'HS256') sig = createHmac('sha256', JSON.stringify(key.jwk)).update(data).digest();
  else if (key.alg === 'RS256') sig = sign('sha256', Buffer.from(data), key.privateKey);
  else sig = sign('sha256', Buffer.from(data), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  if (opts.badSignature) sig = Buffer.from(sig.map((x) => x ^ 0xff));
  return `${data}.${b64(sig)}`;
}

export interface TokenTweaks {
  readonly claims?: Record<string, unknown>;
  readonly sign?: SignOptions;
  readonly key?: IssuerKey;
  readonly omitIdToken?: boolean;
}

export interface MockIssuer {
  readonly issuer: string;
  readonly fetch: OidcFetch;
  readonly counts: { jwks: number; token: number };
  keys: IssuerKey[];
  /** Plays the browser at the authorization endpoint: returns the callback params. */
  authorize(redirectUrl: string, sub: string, tweaks?: TokenTweaks): { state: string; code: string };
  /** Form body of the most recent token request. */
  readonly lastTokenRequest: () => URLSearchParams | undefined;
}

export function createMockIssuer(opts: {
  issuer?: string;
  clientId: string;
  clientSecret?: string;
  now: () => number;
}): MockIssuer {
  const issuer = opts.issuer ?? 'https://idp.example.org/realm';
  const keys = [makeKey('k1')];
  const codes = new Map<string, { challenge: string; nonce: string; sub: string; tweaks: TokenTweaks }>();
  const counts = { jwks: 0, token: 0 };
  let last: URLSearchParams | undefined;
  let n = 0;
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const self: MockIssuer = {
    issuer,
    keys,
    counts,
    lastTokenRequest: () => last,
    authorize(redirectUrl, sub, tweaks = {}) {
      const q = new URL(redirectUrl).searchParams;
      const code = `code-${++n}`;
      codes.set(code, { challenge: q.get('code_challenge') ?? '', nonce: q.get('nonce') ?? '', sub, tweaks });
      return { state: q.get('state') ?? '', code };
    },
    fetch: async (url, init) => {
      if (url === `${issuer}/.well-known/openid-configuration`)
        return json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        });
      if (url === `${issuer}/jwks`) {
        counts.jwks++;
        return json({ keys: self.keys.map((k) => k.jwk) });
      }
      if (url === `${issuer}/token` && init?.method === 'POST') {
        counts.token++;
        const form = new URLSearchParams(String(init.body));
        last = form;
        const entry = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? ''); // single use
        const verifier = form.get('code_verifier') ?? '';
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const secretOk = opts.clientSecret === undefined || form.get('client_secret') === opts.clientSecret;
        if (!entry || !secretOk || challenge !== entry.challenge || form.get('client_id') !== opts.clientId)
          return json({ error: 'invalid_grant' }, 400);
        if (entry.tweaks.omitIdToken) return json({ access_token: 'x', token_type: 'Bearer' });
        const nowS = Math.floor(opts.now() / 1000);
        const claims = {
          iss: issuer,
          aud: opts.clientId,
          sub: entry.sub,
          iat: nowS,
          exp: nowS + 300,
          nonce: entry.nonce,
          email: `${entry.sub}@example.org`,
          ...entry.tweaks.claims,
        };
        const key = entry.tweaks.key ?? self.keys[0];
        if (!key) return json({ error: 'server_error' }, 500);
        return json({
          access_token: 'x',
          token_type: 'Bearer',
          id_token: signJwt(key, claims, entry.tweaks.sign),
        });
      }
      return json({ error: 'not_found' }, 404);
    },
  };
  return self;
}
