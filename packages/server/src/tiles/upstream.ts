/**
 * One polite fetch of a tile from a third-party host (A-033): through the shared host limiter, with the identifying
 * User-Agent, retries with exponential backoff on network errors, 5xx and 429, and the host's `Retry-After` and
 * `Cache-Control` honoured. Nothing here caches: the caller decides what to keep.
 */
import { tileProxyLimit } from '@ueberblick/core';
import type { HostLimiter } from './limiter';
import { UpstreamRefused } from './guard';
import { hostOf } from './source';

export type UpstreamResult =
  /** `ttlS` is the upstream's `s-maxage`, else `max-age` (undefined: it says nothing), `store` false for `no-store`/`private`. */
  | {
      readonly kind: 'ok';
      readonly bytes: Uint8Array;
      readonly contentType: string;
      readonly ttlS: number | undefined;
      readonly store: boolean;
    }
  | { readonly kind: 'notfound' }
  | { readonly kind: 'error'; readonly reason: string };

export interface UpstreamDeps {
  /** The guard's fetch: refuses private addresses, pins the connection, checks every redirect hop. */
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  readonly limiter: HostLimiter;
  readonly userAgent: string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

export type Upstream = (url: string, accept: string) => Promise<UpstreamResult>;

/** `Retry-After` as milliseconds: delta seconds or an HTTP date. */
export function retryAfterMs(header: string | null, now: number): number | undefined {
  if (header === null) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs) * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function cacheControl(header: string | null): { ttlS: number | undefined; store: boolean } {
  const parts = (header ?? '')
    .toLowerCase()
    .split(',')
    .map((p) => p.trim());
  if (parts.includes('no-store') || parts.includes('private')) return { ttlS: undefined, store: false };
  if (parts.includes('no-cache')) return { ttlS: 0, store: true }; // revalidate: fetched each time
  // This proxy is a shared cache, so `s-maxage` wins over `max-age` (RFC 9111 5.2.2.10).
  const age = parts.find((p) => p.startsWith('s-maxage=')) ?? parts.find((p) => p.startsWith('max-age='));
  const secs = age === undefined ? NaN : Number(age.slice(age.indexOf('=') + 1));
  return { ttlS: Number.isFinite(secs) && secs >= 0 ? secs : undefined, store: true };
}

export function createUpstream(deps: UpstreamDeps): Upstream {
  const retries = tileProxyLimit('upstream_retries');
  const base = tileProxyLimit('upstream_retry_base_ms');
  const maxAfter = tileProxyLimit('upstream_retry_after_max_s') * 1000;
  const maxBytes = tileProxyLimit('tile_max_bytes');
  return async (url, accept) => {
    const host = hostOf(url);
    let reason = 'no attempt';
    for (let attempt = 0; attempt <= retries; attempt++) {
      let wait = base * 2 ** attempt;
      try {
        const res = await deps.limiter.run(host, () =>
          deps.fetch(url, { headers: { 'user-agent': deps.userAgent, accept } }),
        );
        if (res.status === 404 || res.status === 410) return { kind: 'notfound' };
        if (res.ok) {
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (bytes.length > maxBytes) return { kind: 'error', reason: 'the answer is too large for a tile' };
          const cc = cacheControl(res.headers.get('cache-control'));
          return { kind: 'ok', bytes, contentType: res.headers.get('content-type') ?? '', ...cc };
        }
        reason = `HTTP ${res.status}`;
        if (res.status !== 429 && res.status < 500) return { kind: 'error', reason };
        const after = retryAfterMs(res.headers.get('retry-after'), deps.now());
        if (after !== undefined) {
          deps.limiter.penalize(host, Math.min(after, maxAfter)); // the limiter does the waiting
          wait = 0;
        }
      } catch (e) {
        if (e instanceof UpstreamRefused) return { kind: 'error', reason: e.message }; // never retried
        reason = e instanceof Error ? e.message : String(e);
      }
      if (attempt < retries) await deps.sleep(wait);
    }
    return { kind: 'error', reason };
  };
}
