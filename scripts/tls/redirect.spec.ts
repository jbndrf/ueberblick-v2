// WP-964: plain http in HTTPS_MODE=direct is answered with a 308 to https, never to a foreign host, and the TLS side
// is unharmed by the redirect listener.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { request } from 'node:https';
import { connect as netConnect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';
import { startFrontFromEnv } from './front.mjs';
import { MAX_HEAD_BYTES, redirectTarget, startHttpRedirect } from './redirect.mjs';

const closers: Array<() => void> = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
});

const hosts = ['127.0.0.1', 'ueberblick.local'];
const portOf = (s: { address(): unknown }): number => (s.address() as AddressInfo).port;

/** Sends raw bytes (in pieces) and returns what came back until the server closes the socket. */
const raw = (port: number, pieces: string[], pauseMs = 30): Promise<string> =>
  new Promise((resolve) => {
    let out = '';
    const c = netConnect(port, '127.0.0.1', async () => {
      for (const p of pieces) {
        c.write(p);
        await new Promise((r) => setTimeout(r, pauseMs));
      }
    });
    c.on('data', (d) => (out += d.toString('latin1')));
    c.on('close', () => resolve(out));
    c.on('error', () => undefined);
  });
const location = (answer: string): string | undefined => /^Location: (.*)\r$/im.exec(answer)?.[1];

const redirector = async (timeoutMs?: number) => {
  const s = await startHttpRedirect({
    host: '127.0.0.1',
    port: 0,
    hosts,
    httpsPort: 9443,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  closers.push(() => s.close());
  return portOf(s);
};

describe('startHttpRedirect', () => {
  it('redirects path and query to https on HTTPS_PORT, keeping a LOCAL_HOSTS host', async () => {
    const port = await redirector();
    const a = await raw(port, ['GET /admin?x=1 HTTP/1.1\r\nHost: 127.0.0.1:80\r\n\r\n']);
    expect(a).toMatch(/^HTTP\/1\.1 308 /);
    expect(location(a)).toBe('https://127.0.0.1:9443/admin?x=1');
    const b = await raw(port, ['GET /a HTTP/1.1\r\nHost: UEBERBLICK.local\r\n\r\n']);
    expect(location(b)).toBe('https://ueberblick.local:9443/a');
  });

  it('sends a foreign Host header to the first LOCAL_HOSTS entry (no open redirect)', async () => {
    const port = await redirector();
    const a = await raw(port, ['GET /x HTTP/1.1\r\nHost: evil.example.com\r\n\r\n']);
    expect(location(a)).toBe('https://127.0.0.1:9443/x');
  });

  it('cannot be steered to another host by the path', async () => {
    const port = await redirector();
    for (const path of [
      '//evil.example.com',
      '/%2F%2Fevil.example.com',
      '@evil.example.com',
      'http://evil.example.com/x',
    ]) {
      const a = await raw(port, [`GET ${path} HTTP/1.1\r\nHost: evil.example.com\r\n\r\n`]);
      const to = location(a) ?? '';
      expect(new URL(to).hostname).toBe('127.0.0.1');
      expect(to.startsWith('https://127.0.0.1:9443/')).toBe(true);
    }
    expect(redirectTarget('x', '/a\u0001b', { hosts, httpsPort: 1 })).toBe('https://127.0.0.1:1/');
  });

  it('refuses CR or LF in the path (no header injection)', async () => {
    const port = await redirector();
    const a = await raw(port, ['GET /a\rSet-Cookie:x HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n']);
    expect(a).toBe('');
    const b = await raw(port, ['GET /a\nSet-Cookie:x HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n']);
    expect(b).toBe('');
    const c = await raw(port, ['GET /a%0d%0aSet-Cookie:x HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n']);
    expect(location(c)).toBe('https://127.0.0.1:9443/a%0d%0aSet-Cookie:x');
    expect(c.split('\r\n\r\n')[0]).not.toMatch(/\r\nSet-Cookie/);
  });

  it('collects a fragmented head', async () => {
    const port = await redirector();
    const a = await raw(port, ['GET /fr', 'ag?y=2 HTTP/1.1\r\nHo', 'st: ueberblick.local\r', '\n\r\n']);
    expect(location(a)).toBe('https://ueberblick.local:9443/frag?y=2');
  });

  it('drops an idle client and an oversized head', async () => {
    const idle = await redirector(150);
    expect(await raw(idle, [])).toBe('');
    const port = await redirector();
    const big = `GET / HTTP/1.1\r\nX: ${'a'.repeat(MAX_HEAD_BYTES)}\r\n\r\n`;
    expect(await raw(port, [big.slice(0, 4000), big.slice(4000)])).toBe('');
    expect(await raw(port, ['not http at all\r\n\r\n'])).toBe('');
  });

  it('close destroys open sockets and calls back once without an error', async () => {
    const s = await startHttpRedirect({ host: '127.0.0.1', port: 0, hosts, httpsPort: 1 });
    const open = netConnect(portOf(s), '127.0.0.1');
    open.on('error', () => undefined);
    await new Promise((r) => open.once('connect', r));
    const calls: unknown[][] = [];
    await new Promise<void>((resolve) =>
      s.close((...a: unknown[]) => {
        calls.push(a);
        resolve();
      }),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toEqual([[]]);
    expect(open.destroyed).toBe(true);
  });
});

describe('the front with the redirect enabled (main() path)', () => {
  const setup = async () => {
    const dir = mkdtempSync(join(tmpdir(), 'redirect-spec-'));
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const app: Server = createServer((_req, res) => res.end('hello'));
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', () => r()));
    closers.push(() => app.close());
    const started = await startFrontFromEnv(
      {
        DATA_DIR: dir,
        LOCAL_HOSTS: '127.0.0.1',
        PORT: String(portOf(app)),
        HTTPS_PORT: '9443',
        HTTP_PORT: '',
      },
      { host: '127.0.0.1', httpsPort: 0, httpPort: 0 },
    );
    closers.push(() => {
      started.stopRenewal();
      started.front.close();
      started.redirect?.close();
    });
    return { started, ca: readFileSync(join(dir, 'tls', 'ca.crt'), 'utf8') };
  };

  it('serves a real TLS client and answers http on the redirect port', async () => {
    const { started, ca } = await setup();
    expect(started.redirect).not.toBeNull();
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: portOf(started.front), path: '/', ca }, (r) => {
        let body = '';
        r.on('data', (c: Buffer) => (body += c.toString()));
        r.on('end', () => resolve({ status: r.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      req.end();
    });
    expect(res).toEqual({ status: 200, body: 'hello' });
    const a = await raw(portOf(started.redirect as Server), [
      'GET /admin?x=1 HTTP/1.1\r\nHost: localhost\r\n\r\n',
    ]);
    expect(location(a)).toBe('https://127.0.0.1:9443/admin?x=1');
  });

  it('lets a second connection resume the TLS session', async () => {
    const { started, ca } = await setup();
    const port = portOf(started.front);
    const open = (session?: Buffer): Promise<{ socket: TLSSocket; session: Buffer }> =>
      new Promise((resolve, reject) => {
        const socket = tlsConnect({ host: '127.0.0.1', port, ca, ...(session ? { session } : {}) });
        if (session) socket.once('secureConnect', () => resolve({ socket, session }));
        else socket.once('session', (s: Buffer) => resolve({ socket, session: s }));
        // TLS 1.3 tickets arrive with the first reads
        socket.on('connect', () => socket.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n'));
        socket.resume();
        socket.on('error', reject);
      });
    const first = await open();
    first.socket.destroy();
    const second = await open(first.session);
    expect(second.socket.isSessionReused()).toBe(true);
    second.socket.destroy();
  });
});
