/**
 * What the app believes about how a request arrived (WP-941). The app itself only speaks plain http: TLS is ended by
 * the admin's proxy (`HTTPS_MODE=proxy`) or by the front in the same container (`direct`). `X-Forwarded-*` is read
 * only when the peer is such a proxy: an address or range in `TRUSTED_PROXIES`, or loopback in direct mode (where
 * `TRUSTED_PROXIES` is ignored, the front is always on loopback). From anyone else the headers are ignored.
 * In direct mode a request that did not come through the front is redirected to https.
 */
import { BlockList, isIP } from 'node:net';
import type { Config } from '../config';

export type GateConfig = Pick<Config, 'httpsMode' | 'trustedProxies' | 'localHosts' | 'httpsPort'>;

export interface Gate {
  /** The browser used https to reach the proxy or front. */
  readonly https: boolean;
  /** The real client: the first address from the right of `X-Forwarded-For` that is not a trusted proxy. */
  readonly clientAddress: string;
  /** Where to send a plain-http request (direct mode), else null. */
  readonly redirect: string | null;
}

const LOOPBACK = ['127.0.0.0/8', '::1'];
/** The probe of the container's health check, over plain http. */
const HEALTH_PATH = '/api/health';

/** `::ffff:1.2.3.4` is `1.2.3.4`. */
const plain = (address: string): string => address.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');

function listOf(ranges: readonly string[]): BlockList {
  const list = new BlockList();
  for (const r of ranges) {
    const [ip = '', bits] = r.split('/');
    const family = isIP(ip) === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) list.addAddress(ip, family);
    else list.addSubnet(ip, Number(bits), family);
  }
  return list;
}

const isIn = (list: BlockList, address: string): boolean => {
  const ip = plain(address);
  const v = isIP(ip);
  return v !== 0 && list.check(ip, v === 6 ? 'ipv6' : 'ipv4');
};

/** `192.168.1.20:3000` or `[fd00::5]:3000` to the host part. */
const hostOnly = (host: string): string => {
  if (host.startsWith('[')) return host.slice(1, host.indexOf(']'));
  return host.replace(/:\d+$/, '');
};

function redirectTo(config: GateConfig, headers: Headers, path: string): string {
  const asked = hostOnly(headers.get('host') ?? '').toLowerCase();
  const host = config.localHosts.find((h) => h.toLowerCase() === asked) ?? config.localHosts[0] ?? asked;
  return `https://${isIP(host) === 6 ? `[${host}]` : host}:${config.httpsPort}${path}`;
}

/**
 * @param peer the socket address of the connection (what SvelteKit's `getClientAddress` gives without `ADDRESS_HEADER`)
 * @param path path and query of the request
 */
export function transportGate(input: {
  config: GateConfig;
  peer: string;
  headers: Headers;
  path: string;
}): Gate {
  const { config, peer, headers, path } = input;
  const direct = config.httpsMode === 'direct';
  const trusted = listOf(direct ? LOOPBACK : config.trustedProxies);
  if (!isIn(trusted, peer)) {
    const plainHttp = direct && path.split('?')[0] !== HEALTH_PATH;
    return {
      https: false,
      clientAddress: peer,
      redirect: plainHttp ? redirectTo(config, headers, path) : null,
    };
  }
  const hops = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((h) => plain(h.trim()))
    .filter((h) => h !== '');
  const client = [...hops].reverse().find((h) => !isIn(trusted, h)) ?? hops[0] ?? peer;
  return {
    https: (headers.get('x-forwarded-proto') ?? '').split(',')[0]?.trim().toLowerCase() === 'https',
    clientAddress: client,
    redirect: null,
  };
}
