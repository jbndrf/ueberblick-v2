/**
 * The SSRF guard of the tile proxy (A-033): the one place that decides whether this server may contact a layer's URL.
 * The proxy upstream, the pack builder's range fetches and the pack readers all go through it (R1).
 *
 * - **Resolve once, pin.** The host is resolved here; every address must be public (`isPublicAddress`) and the connection
 *   goes to that validated address (Host header and TLS name stay the host's), so a DNS answer cannot change between
 *   the check and the connect (rebinding).
 * - **The instance itself** (`PUBLIC_URL`'s host) is refused by name.
 * - **Redirects** are followed by hand, at most `MAX_REDIRECTS` hops, and every hop passes the same check.
 * - A refusal is a typed `UpstreamRefused` and happens before any request is made.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { UPSTREAM_REFUSALS, type UpstreamRefusal } from '@ueberblick/core';
import { isPublicAddress } from './address';
import { pinnedTransport, type Pinned, type Transport } from './pinned-fetch';

export class UpstreamRefused extends Error {
  constructor(
    readonly refusal: UpstreamRefusal,
    readonly target: string,
  ) {
    super(`${UPSTREAM_REFUSALS.get(refusal).description} (${target})`);
  }
}

export type Lookup = (host: string) => Promise<readonly Pinned[]>;

export interface Guard {
  /** Fetches `url` through the checks above; throws `UpstreamRefused` and makes no request when refused. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** The check alone: resolves when `url` may be contacted. */
  check(url: string): Promise<void>;
}

export interface GuardOptions {
  /** The instance's own host name (from `PUBLIC_URL`); contacting it is refused. */
  readonly ownHost?: string;
  /** Test seam: the resolver (default: the system's `dns.lookup`, all addresses). */
  readonly lookup?: Lookup;
  /** Test seam: the connection (default: node `http(s).request` to the pinned address). */
  readonly transport?: Transport;
}

const MAX_REDIRECTS = 3;

const systemLookup: Lookup = async (host) =>
  (await dnsLookup(host, { all: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));

/** The host of a URL for comparing: lower case, without the brackets of an IPv6 literal. */
const bare = (hostname: string): string => hostname.toLowerCase().replace(/^\[|\]$/g, '');

export function createGuard(opts: GuardOptions = {}): Guard {
  const lookup = opts.lookup ?? systemLookup;
  const transport = opts.transport ?? pinnedTransport;
  const own = opts.ownHost === undefined ? undefined : bare(opts.ownHost);

  /** The validated address to connect to. */
  async function resolve(url: string): Promise<Pinned> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new UpstreamRefused('bad_url', url);
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UpstreamRefused('bad_url', url);
    const host = bare(u.hostname);
    if (host === '') throw new UpstreamRefused('bad_url', url);
    if (own !== undefined && host === own) throw new UpstreamRefused('own_host', host);
    const family = isIP(host);
    let found: readonly Pinned[];
    if (family !== 0) found = [{ address: host, family: family === 6 ? 6 : 4 }];
    else {
      try {
        found = await lookup(host);
      } catch {
        throw new UpstreamRefused('unresolved', host);
      }
    }
    const first = found[0];
    if (first === undefined) throw new UpstreamRefused('unresolved', host);
    // One private answer among public ones refuses the host: it must not be a way in for a later connect.
    if (!found.every((a) => isPublicAddress(a.address))) throw new UpstreamRefused('private_address', host);
    return first;
  }

  return {
    async check(url) {
      await resolve(url);
    },
    async fetch(url, init = {}) {
      let current = url;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const pinned = await resolve(current);
        const res = await transport(current, init, pinned);
        const location = res.headers.get('location');
        if (res.status < 300 || res.status >= 400 || location === null || res.status === 304) return res;
        try {
          current = new URL(location, current).href;
        } catch {
          throw new UpstreamRefused('bad_url', location);
        }
      }
      throw new UpstreamRefused('too_many_redirects', url);
    },
  };
}
