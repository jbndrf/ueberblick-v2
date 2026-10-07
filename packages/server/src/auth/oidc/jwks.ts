/** Discovery and JWKS retrieval with a TTL cache. The only network access of the OIDC module, through an injected fetch. */
import type { Jwk } from './jwt';
import { keyFits } from './jwt';
import { OIDC_PARAMS } from './params';
import type { OidcAlgorithm } from './registry';

/** Port: the subset of `fetch` the module needs. */
export type OidcFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>;

export interface Endpoints {
  readonly authorization: string;
  readonly token: string;
  readonly jwks: string;
}

interface Cached<T> {
  readonly value: T;
  readonly at: number;
}

const str = (x: unknown): string | null => (typeof x === 'string' && x.length > 0 ? x : null);

export interface KeySource {
  /** Null when discovery fails or the document names another issuer. */
  endpoints(issuer: string): Promise<Endpoints | null>;
  /** Finds the signing key for a token; an unknown `kid` triggers one rate-limited refetch (rotation). */
  key(issuer: string, kid: string | undefined, alg: OidcAlgorithm): Promise<Jwk | null>;
}

export function createKeySource(deps: { fetch: OidcFetch; now: () => number }): KeySource {
  const docs = new Map<string, Cached<Endpoints>>();
  const sets = new Map<string, Cached<readonly Jwk[]>>();
  const fetchedAt = new Map<string, number>();

  async function getJson(url: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await deps.fetch(url);
      if (!res.ok) return null;
      const body: unknown = await res.json();
      return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  async function endpoints(issuer: string): Promise<Endpoints | null> {
    const hit = docs.get(issuer);
    if (hit && deps.now() - hit.at < OIDC_PARAMS.jwksTtlMs) return hit.value;
    const doc = await getJson(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
    const authorization = str(doc?.['authorization_endpoint']);
    const token = str(doc?.['token_endpoint']);
    const jwks = str(doc?.['jwks_uri']);
    if (!doc || doc['issuer'] !== issuer || !authorization || !token || !jwks) return null;
    const value = { authorization, token, jwks };
    docs.set(issuer, { value, at: deps.now() });
    return value;
  }

  async function load(issuer: string, force: boolean): Promise<readonly Jwk[]> {
    const hit = sets.get(issuer);
    const t = deps.now();
    if (hit && t - hit.at < OIDC_PARAMS.jwksTtlMs && !force) return hit.value;
    if (force && t - (fetchedAt.get(issuer) ?? -Infinity) < OIDC_PARAMS.jwksMinRefetchMs)
      return hit?.value ?? [];
    const ep = await endpoints(issuer);
    const body = ep ? await getJson(ep.jwks) : null;
    fetchedAt.set(issuer, t);
    const keys = body && Array.isArray(body['keys']) ? (body['keys'] as Jwk[]) : null;
    if (!keys) return hit?.value ?? [];
    sets.set(issuer, { value: keys, at: t });
    return keys;
  }

  const pick = (keys: readonly Jwk[], kid: string | undefined, alg: OidcAlgorithm): Jwk | null => {
    const fit = keys.filter((k) => keyFits(k, alg));
    if (kid !== undefined) return fit.find((k) => k.kid === kid) ?? null;
    return fit.length === 1 ? (fit[0] ?? null) : null;
  };

  return {
    endpoints,
    async key(issuer, kid, alg) {
      const found = pick(await load(issuer, false), kid, alg);
      if (found) return found;
      return pick(await load(issuer, true), kid, alg);
    },
  };
}
