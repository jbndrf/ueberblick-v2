// WP-941: forwarded headers are honoured only from trusted addresses; direct mode redirects plain http.
import { describe, expect, it } from 'vitest';
import { transportGate, type GateConfig } from './gate';

const proxy: GateConfig = {
  httpsMode: 'proxy',
  trustedProxies: ['10.0.0.0/8', '192.168.1.7'],
  localHosts: [],
  httpsPort: 8443,
};
const direct: GateConfig = {
  httpsMode: 'direct',
  trustedProxies: ['203.0.113.9'], // ignored in direct mode: the front is on loopback
  localHosts: ['192.168.1.20', 'box.local'],
  httpsPort: 8443,
};
const call = (
  config: GateConfig,
  peer: string,
  headers: Record<string, string> = {},
  path = '/app?x=1',
  host = 'ueberblick.example.org',
) => transportGate({ config, peer, headers: new Headers({ host, ...headers }), path });

describe('proxy mode', () => {
  it('sees https and the real client from a trusted proxy', () => {
    const g = call(proxy, '10.1.2.3', { 'x-forwarded-proto': 'https', 'x-forwarded-for': '198.51.100.4' });
    expect(g.https).toBe(true);
    expect(g.clientAddress).toBe('198.51.100.4');
    expect(g.redirect).toBeNull();
  });

  it('ignores the same headers from an untrusted address', () => {
    const g = call(proxy, '198.51.100.99', { 'x-forwarded-proto': 'https', 'x-forwarded-for': '1.2.3.4' });
    expect(g.https).toBe(false);
    expect(g.clientAddress).toBe('198.51.100.99');
  });

  it('takes the first address from the right that is not a trusted proxy (a spoofed left part does not count)', () => {
    const g = call(proxy, '10.0.0.1', {
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '6.6.6.6, 198.51.100.4, 10.0.0.2',
    });
    expect(g.clientAddress).toBe('198.51.100.4');
  });

  it('understands IPv4-mapped IPv6 peers and exact addresses', () => {
    expect(call(proxy, '::ffff:192.168.1.7', { 'x-forwarded-proto': 'https' }).https).toBe(true);
    expect(call(proxy, '::ffff:192.168.1.8', { 'x-forwarded-proto': 'https' }).https).toBe(false);
  });

  it('trusts nobody when TRUSTED_PROXIES is empty, and never redirects', () => {
    const g = call({ ...proxy, trustedProxies: [] }, '10.0.0.1', { 'x-forwarded-proto': 'https' });
    expect(g.https).toBe(false);
    expect(g.redirect).toBeNull();
  });

  it('only "https" counts as https', () => {
    expect(call(proxy, '10.0.0.1', { 'x-forwarded-proto': 'http' }).https).toBe(false);
  });
});

describe('direct mode', () => {
  it('trusts the loopback front only', () => {
    const viaFront = call(direct, '127.0.0.1', {
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '192.168.1.50',
    });
    expect(viaFront.https).toBe(true);
    expect(viaFront.clientAddress).toBe('192.168.1.50');
    expect(viaFront.redirect).toBeNull();
    const spoof = call(direct, '203.0.113.9', { 'x-forwarded-proto': 'https' }, '/', '192.168.1.20:3000');
    expect(spoof.https).toBe(false);
    expect(spoof.redirect).toBe('https://192.168.1.20:8443/');
    expect(call(direct, '::1', { 'x-forwarded-proto': 'https' }).https).toBe(true);
  });

  it('redirects plain http to https on HTTPS_PORT, keeping path and query', () => {
    const g = call(direct, '192.168.1.50', {}, '/app?x=1', '192.168.1.20:3000');
    expect(g.redirect).toBe('https://192.168.1.20:8443/app?x=1');
  });

  it('never redirects to a host that is not in LOCAL_HOSTS (no open redirect through the Host header)', () => {
    const g = call(direct, '192.168.1.50', {}, '/', 'evil.example');
    expect(g.redirect).toBe('https://192.168.1.20:8443/');
  });

  it('keeps IPv6 hosts in brackets', () => {
    const v6 = { ...direct, localHosts: ['fd00::5'] };
    expect(call(v6, '192.168.1.50', {}, '/', '[fd00::5]:3000').redirect).toBe('https://[fd00::5]:8443/');
  });

  it('leaves the health check alone (the container probes plain http on loopback)', () => {
    expect(call(direct, '127.0.0.1', {}, '/api/health', '127.0.0.1:3000').redirect).toBeNull();
    expect(call(direct, '192.168.1.50', {}, '/api/health', '192.168.1.20:3000').redirect).toBeNull();
  });
});
