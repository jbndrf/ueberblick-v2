// DEMO ONLY. The door of the demo: one listener on the LAN that forwards everything to the web app, which itself only
// listens on loopback. It exists because browsers give the offline features of the participant app (Web Locks, the
// service worker) to secure origins only: over plain http from another device the app shows "could not be loaded".
// So the door speaks https with a local CA's certificate (install the CA once at /setup/zertifikat), unless `--http` is given.
// It also tells the app which address and protocol the browser used (X-Forwarded-*), which `HOST_HEADER`/`PROTOCOL_HEADER` of adapter-node read.
import { createServer as createHttp, request as httpRequest } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { join } from 'node:path';
import { loadTlsMaterial } from '../tls/cert.mjs';

/**
 * The TLS material of the demo, made by the same code as the Docker stack (`scripts/tls/cert.mjs`): a local CA and a
 * server certificate for localhost and every given address, in `<dir>/tls`, reissued when the addresses change. The
 * app serves that CA at `/setup/zertifikat` (it reads `<DATA_DIR>/tls/ca.crt`), so a device can trust it once.
 */
export function ensureCert(dir, addresses) {
  const { server } = loadTlsMaterial({
    dir: join(dir, 'tls'),
    hosts: ['localhost', '127.0.0.1', ...addresses],
  });
  return { key: Buffer.from(server.keyPem), cert: Buffer.from(server.certPem) };
}

/**
 * @param {{ host: string, port: number, appPort: number, tls?: { key: Buffer, cert: Buffer } }} o
 */
export function startFront(o) {
  const proto = o.tls === undefined ? 'http' : 'https';
  const handle = async (req, res) => {
    const up = httpRequest(
      {
        host: '127.0.0.1',
        port: o.appPort,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          'accept-encoding': 'identity', // a page is rewritten below, so it must arrive as plain text
          'x-forwarded-proto': proto,
          'x-forwarded-host': req.headers.host ?? '',
          'x-forwarded-for': req.socket.remoteAddress ?? '',
        },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    up.on('error', () => {
      if (!res.headersSent) res.statusCode = 502;
      res.end('the demo app is not reachable');
    });
    res.on('close', () => up.destroy()); // an event stream ends when the browser leaves
    req.pipe(up);
  };
  const server = o.tls === undefined ? createHttp(handle) : createHttps(o.tls, handle);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, o.host, () => resolve(server));
  });
}
