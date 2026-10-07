import { describe, expect, it } from 'vitest';
import type { GateConfig } from '../tls/gate';
import { entryGuard } from './entry';

const proxy: GateConfig = {
  httpsMode: 'proxy',
  trustedProxies: ['10.0.0.0/8'],
  localHosts: ['192.168.1.20'],
  httpsPort: 8443,
};
const direct: GateConfig = { ...proxy, httpsMode: 'direct', trustedProxies: [] };

const run = (config: GateConfig, peer: string, headers: Record<string, string>, path = '/') =>
  entryGuard({
    config,
    uploadLimitBytes: 1000,
    request: new Request(`http://app.test${path}`, {
      method: 'POST',
      headers: { host: '192.168.1.20:3000', ...headers },
    }),
    peer,
    path,
  });

describe('entryGuard', () => {
  it('sends HSTS behind a trusted proxy that forwards https, also on a 413', () => {
    const ok = run(proxy, '10.1.1.1', { 'x-forwarded-proto': 'https' });
    expect(ok.early).toBeUndefined();
    expect(ok.gate.https).toBe(true);
    const big = run(proxy, '10.1.1.1', { 'x-forwarded-proto': 'https', 'content-length': '5000' });
    expect(big.early?.status).toBe(413);
    expect(big.early?.headers.get('strict-transport-security')).toMatch(/max-age/);
    expect(big.early?.headers.get('x-frame-options')).toBe('DENY');
  });

  it('sends no HSTS when the proxy is not trusted or says http', () => {
    const big = (peer: string, proto: string) =>
      run(proxy, peer, { 'x-forwarded-proto': proto, 'content-length': '5000' }).early;
    expect(big('198.51.100.9', 'https')?.headers.has('strict-transport-security')).toBe(false);
    expect(big('10.1.1.1', 'http')?.headers.has('strict-transport-security')).toBe(false);
  });

  it('refuses an oversize body with 413 in direct mode through the front, with HSTS', () => {
    const r = run(direct, '127.0.0.1', { 'x-forwarded-proto': 'https', 'content-length': '5000' }).early;
    expect(r?.status).toBe(413);
    expect(r?.headers.get('strict-transport-security')).toMatch(/max-age/);
  });

  it('redirects plain http in direct mode and the redirect carries the security headers (no HSTS over http)', () => {
    const r = run(direct, '203.0.113.9', {}, '/app?x=1').early;
    expect(r?.status).toBe(308);
    expect(r?.headers.get('location')).toBe('https://192.168.1.20:8443/app?x=1');
    expect(r?.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r?.headers.get('content-security-policy')).toBeTruthy();
    expect(r?.headers.has('strict-transport-security')).toBe(false);
  });

  it('the redirect wins over the upload limit', () => {
    expect(run(direct, '203.0.113.9', { 'content-length': '5000' }).early?.status).toBe(308);
  });
});
