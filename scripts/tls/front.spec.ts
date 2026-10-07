// WP-941: the TLS front forwards HTTPS to the app on loopback and says what the browser used; the renewal keeps the
// certificate of a container alive past its 397 days without a restart.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { X509Certificate } from 'node:crypto';
import { connect as tlsConnect } from 'node:tls';
import { loadTlsMaterial } from './cert.mjs';
import { startRenewal, startTlsFront } from './front.mjs';

const closers: Array<() => void> = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
});

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    closers.push(() => server.close());
  });

const get = (port: number, ca: string, path: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const req = httpsRequest({ host: '127.0.0.1', port, path, ca }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });

describe('startTlsFront', () => {
  it('serves HTTPS with a certificate the CA vouches for and forwards to the app with X-Forwarded-*', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'front-spec-'));
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const m = loadTlsMaterial({ dir, hosts: ['127.0.0.1'] });
    let seen: IncomingHttpHeaders = {};
    const upstreamPort = await listen(
      createServer((req, res) => {
        seen = req.headers;
        res.end(`hello ${req.url}`);
      }),
    );
    const front = await startTlsFront(
      { key: m.server.keyPem, cert: m.server.certPem },
      { host: '127.0.0.1', port: 0, upstreamPort },
    );
    closers.push(() => front.close());
    const port = (front.address() as AddressInfo).port;
    const res = await get(port, readFileSync(join(dir, 'ca.crt'), 'utf8'), '/api/health?x=1');
    expect(res).toEqual({ status: 200, body: 'hello /api/health?x=1' });
    expect(seen['x-forwarded-proto']).toBe('https');
    expect(seen['x-forwarded-for']).toMatch(/127\.0\.0\.1/);
    expect(seen['x-forwarded-host']).toBe(`127.0.0.1:${port}`);
  });

  it('refuses a client that does not trust the CA, and answers 502 while the app is down', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'front-spec-'));
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const m = loadTlsMaterial({ dir, hosts: ['127.0.0.1'] });
    const front = await startTlsFront(
      { key: m.server.keyPem, cert: m.server.certPem },
      { host: '127.0.0.1', port: 0, upstreamPort: 1 },
    );
    closers.push(() => front.close());
    const port = (front.address() as AddressInfo).port;
    await expect(get(port, '', '/')).rejects.toThrow(/self-signed|unable to verify|certificate/i);
    expect((await get(port, readFileSync(join(dir, 'ca.crt'), 'utf8'), '/')).status).toBe(502);
  });
});

describe('startRenewal (a container that never restarts outlives the certificate)', () => {
  const DAY = 86_400_000;
  const t0 = new Date('2026-01-01T00:00:00Z');
  const at = (days: number): Date => new Date(t0.getTime() + days * DAY);

  /** The front running with a certificate made at `now`; the upstream is down (only the TLS context is tested). */
  const running = async (now: Date) => {
    const dir = mkdtempSync(join(tmpdir(), 'renew-spec-'));
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const m = loadTlsMaterial({ dir, hosts: ['127.0.0.1'], now });
    const front = await startTlsFront(
      { key: m.server.keyPem, cert: m.server.certPem },
      { host: '127.0.0.1', port: 0, upstreamPort: 1 },
    );
    closers.push(() => front.close());
    return { dir, port: (front.address() as AddressInfo).port, front };
  };

  /** One full TLS handshake without a client session: the certificate the running front presents. The Node https
   *  client caches sessions per process and would keep reporting the certificate of the resumed (pre-swap)
   *  session, so the probe must not reuse sessions. `rejectUnauthorized` is off because the injected clock puts the
   *  renewed certificate's validity window after the real wall clock; the chain to the CA is asserted on disk. */
  const peer = (port: number, ca: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const sock = tlsConnect({ host: '127.0.0.1', port, ca, rejectUnauthorized: false }, () => {
        const serial = sock.getPeerCertificate().serialNumber;
        resolve(serial);
        sock.destroy();
      });
      sock.on('error', reject);
    });

  it('reissues a certificate that is near expiry and hot-swaps it on the running front, with the CA unchanged', async () => {
    const { dir, port, front } = await running(t0);
    const ca = readFileSync(join(dir, 'ca.crt'), 'utf8');
    const before = await peer(port, ca);
    // the certificate made at t0 is valid for 397 days; at t0 + 377 days it has 20 days left, inside the 30-day window
    startRenewal(front, { dir, hosts: ['127.0.0.1'], clock: () => at(377) });
    const renewed = new X509Certificate(readFileSync(join(dir, 'server.crt'), 'utf8'));
    expect(renewed.validToDate.getTime()).toBe(at(774).getTime());
    expect(readFileSync(join(dir, 'ca.crt'), 'utf8')).toBe(ca); // reissued with the same CA
    expect(renewed.verify(new X509Certificate(ca).publicKey)).toBe(true);
    expect(await peer(port, ca)).not.toBe(before); // no restart: the same front now presents the new certificate
  });

  it('checks again on the timer and renews only once the certificate is near expiry', async () => {
    const { dir, front } = await running(t0);
    const ca = readFileSync(join(dir, 'ca.crt'), 'utf8');
    const before = readFileSync(join(dir, 'server.crt'), 'utf8');
    let now = at(100); // about 297 days left: still far from the window
    const stop = startRenewal(front, { dir, hosts: ['127.0.0.1'], clock: () => now, intervalMs: 50 });
    closers.push(stop);
    expect(readFileSync(join(dir, 'server.crt'), 'utf8')).toBe(before);
    now = at(377);
    await new Promise((r) => setTimeout(r, 250));
    expect(readFileSync(join(dir, 'server.crt'), 'utf8')).not.toBe(before);
    expect(readFileSync(join(dir, 'ca.crt'), 'utf8')).toBe(ca);
  });
});
