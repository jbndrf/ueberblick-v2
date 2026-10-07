/**
 * The network port of the build job (A-032): everything it reads from a tile source goes through `fetchRange`, so tests
 * use a local archive and a later source type (xyz, WMS) is another adapter, not another shape.
 */
import { isSameOriginPath } from '@ueberblick/core';

/** The source answered 404 for the range: the thing is absent (not a failure to retry). */
export class RangeNotFound extends Error {
  constructor(readonly url: string) {
    super(`${url}: HTTP 404 for a range request`);
  }
}

export type FetchRange = (url: string, offset: number, length: number) => Promise<Uint8Array>;

export interface RetryOptions {
  /** Tries after the first one. Default 3. */
  readonly retries?: number;
  /** Wait before the first retry; it doubles each time. Default 500 ms. */
  readonly baseDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** `fetchRange` that retries a failure with exponential backoff and throws the last error when the tries run out. */
export function withRetries(inner: FetchRange, opts: RetryOptions = {}): FetchRange {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return async (url, offset, length) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await inner(url, offset, length);
      } catch (e) {
        if (e instanceof RangeNotFound || attempt >= retries) throw e;
        await sleep(base * 2 ** attempt);
      }
    }
  };
}

export interface HttpFetchOptions {
  readonly fetch?: typeof fetch;
  /** Identifies the server to the tile host (A-032: polite). */
  readonly userAgent: string;
  /** Requests in flight at once. Default 2. */
  readonly concurrency?: number;
  /** Relative source URLs (`/…`, a path on this server) resolve against this origin. */
  readonly baseUrl?: string;
  /**
   * How a same-origin path is read (default: the global `fetch`). It never goes through `fetch` above, which is the
   * SSRF guard in the runtime: the URL is built by us from the origin plus a path, unauthenticated, so it can only
   * reach what the public can (A-033 item 9).
   */
  readonly originFetch?: typeof fetch;
}

/** A same-origin path against the origin; throws when the result leaves the origin (defence in depth). */
function ownUrl(path: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  const u = new URL(path, base);
  if (u.origin !== base.origin) throw new Error(`${path} does not stay on this instance`);
  return u.href;
}

/** HTTP range requests with a concurrency limit and an identifying User-Agent. */
export function httpFetchRange(opts: HttpFetchOptions): FetchRange {
  const doFetch = opts.fetch ?? fetch;
  const limit = Math.max(1, opts.concurrency ?? 2);
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = async (): Promise<void> => {
    if (active >= limit) await new Promise<void>((r) => waiting.push(r));
    active++;
  };
  const release = (): void => {
    active--;
    waiting.shift()?.();
  };
  return async (url, offset, length) => {
    const own = isSameOriginPath(url) && opts.baseUrl !== undefined;
    const absolute = own ? ownUrl(url, opts.baseUrl as string) : url;
    await acquire();
    try {
      const res = await (own ? (opts.originFetch ?? fetch) : doFetch)(absolute, {
        headers: { range: `bytes=${offset}-${offset + length - 1}`, 'user-agent': opts.userAgent },
      });
      if (res.status === 404) throw new RangeNotFound(absolute);
      if (res.status !== 206 && !(res.status === 200 && offset === 0))
        throw new Error(`${absolute}: HTTP ${res.status} for a range request`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      return res.status === 200 ? bytes.subarray(0, length) : bytes;
    } finally {
      release();
    }
  };
}
