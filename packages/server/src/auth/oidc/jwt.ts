/** Compact-JWS parsing, signature and claim checks for ID tokens (OIDC Core 3.1.3.7, RFC 9700). Pure: no I/O. */
import { createPublicKey, verify } from 'node:crypto';
import { safeEqual } from '../crypto';
import { OIDC_ALGORITHMS, type OidcAlgorithm } from './registry';

export interface Jwk {
  readonly kty?: string;
  readonly kid?: string;
  readonly use?: string;
  readonly alg?: string;
  readonly crv?: string;
  readonly [k: string]: unknown;
}

export interface ParsedJwt {
  readonly alg: OidcAlgorithm;
  readonly kid: string | undefined;
  readonly claims: Readonly<Record<string, unknown>>;
  readonly signingInput: string;
  readonly signature: Buffer;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

function decode(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

/** Refuses anything whose header algorithm is not in `allowed` (so `none` and HS* never get through). */
export function parseJwt(token: string, allowed: readonly OidcAlgorithm[]): ParsedJwt | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const header = decode(h);
  const claims = decode(p);
  if (!isRecord(header) || !isRecord(claims)) return null;
  const alg = header['alg'];
  if (typeof alg !== 'string' || !OIDC_ALGORITHMS.has(alg) || !allowed.includes(alg)) return null;
  const kid = typeof header['kid'] === 'string' ? header['kid'] : undefined;
  return { alg, kid, claims, signingInput: `${h}.${p}`, signature: Buffer.from(s, 'base64url') };
}

const KTY: Record<OidcAlgorithm, string> = { RS256: 'RSA', ES256: 'EC' };

/** True when the JWK is a signing key of the right type for `alg` (a key never verifies another family's algorithm). */
export function keyFits(jwk: Jwk, alg: OidcAlgorithm): boolean {
  if (jwk.kty !== KTY[alg]) return false;
  if (jwk.use !== undefined && jwk.use !== 'sig') return false;
  if (jwk.alg !== undefined && jwk.alg !== alg) return false;
  return alg !== 'ES256' || jwk.crv === 'P-256';
}

export function verifySignature(jwt: ParsedJwt, jwk: Jwk): boolean {
  if (!keyFits(jwk, jwt.alg)) return false;
  try {
    const key = createPublicKey({ key: jwk as never, format: 'jwk' });
    const data = Buffer.from(jwt.signingInput);
    return jwt.alg === 'RS256'
      ? verify('sha256', data, key, jwt.signature)
      : verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, jwt.signature);
  } catch {
    return false;
  }
}

export interface ClaimExpectations {
  readonly issuer: string;
  readonly clientId: string;
  readonly nonce: string;
  /** Epoch milliseconds. */
  readonly now: number;
  readonly skewSeconds: number;
}

/** iss, aud (+azp), exp, iat, nonce, sub. Returns the subject on success. */
export function checkClaims(claims: Readonly<Record<string, unknown>>, e: ClaimExpectations): string | null {
  const nowS = Math.floor(e.now / 1000);
  const { iss, aud, azp, exp, iat, nonce, sub } = claims;
  if (iss !== e.issuer) return null;
  const audiences = typeof aud === 'string' ? [aud] : Array.isArray(aud) ? aud : [];
  if (!audiences.includes(e.clientId)) return null;
  if (audiences.length > 1 && azp !== e.clientId) return null;
  if (azp !== undefined && azp !== e.clientId) return null;
  if (typeof exp !== 'number' || exp + e.skewSeconds <= nowS) return null;
  if (typeof iat !== 'number' || iat - e.skewSeconds > nowS) return null;
  if (typeof nonce !== 'string' || !safeEqual(nonce, e.nonce)) return null;
  return typeof sub === 'string' && sub.length > 0 ? sub : null;
}
