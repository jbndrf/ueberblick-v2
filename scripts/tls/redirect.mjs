// The plain-http side of HTTPS_MODE=direct (WP-964): a request on http gets a 308 to the same path on https, and
// nothing else is served. The host in the target is the request's own host only when it is in LOCAL_HOSTS, otherwise
// the first LOCAL_HOSTS entry, so the redirect can never point at a foreign address.
import { createServer } from 'node:net';

/** Longest request head read, and how long a client may stay silent before its first complete head. */
export const MAX_HEAD_BYTES = 8192;
export const HEAD_TIMEOUT_MS = 5000;

/** The host name of a Host header, lower case, without port or IPv6 brackets. */
function hostName(header) {
  const h = header.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return h.slice(1, end === -1 ? undefined : end);
  }
  const i = h.lastIndexOf(':');
  return i === -1 ? h : h.slice(0, i);
}

/**
 * The https address a plain-http request is sent to.
 * @param {string | undefined} hostHeader the request's Host header (with or without port)
 * @param {string | undefined} path the request target (path and query)
 * @param {{ hosts: readonly string[], httpsPort: number }} o
 * @returns {string | null} null when `hosts` is empty
 */
export function redirectTarget(hostHeader, path, o) {
  const first = o.hosts[0];
  if (first === undefined) return null;
  const name = hostHeader === undefined ? '' : hostName(hostHeader);
  const host = o.hosts.find((h) => h.toLowerCase() === name) ?? first;
  const bracketed = host.includes(':') ? `[${host}]` : host;
  const clean = path !== undefined && path.startsWith('/') && !/[\u0000- \u007f]/.test(path);
  return `https://${bracketed}:${o.httpsPort}${clean ? path : '/'}`;
}

/**
 * Reads the request line and Host header of a plain-http request head (up to the blank line).
 * @param {string} head
 * @returns {{ path: string, host: string | undefined } | null} null when it does not look like HTTP
 */
export function parseRequestHead(head) {
  const [line, ...headers] = head.split('\r\n');
  const m = /^[A-Z]{3,10} (\S+) HTTP\/1\.[01]$/.exec(line ?? '');
  if (!m) return null;
  const host = headers.map((h) => /^host:\s*(.*)$/i.exec(h)?.[1]).find((v) => v !== undefined);
  return { path: m[1] ?? '/', host };
}

/**
 * The tiny http listener: every request is answered with a 308 to https, over a raw socket so a slow, fragmented or
 * oversized head cannot hold resources: the head is collected up to MAX_HEAD_BYTES until the blank line, a client
 * that stays silent for `timeoutMs` is dropped, and `close` destroys open sockets.
 * @param {{ host: string, port: number, hosts: readonly string[], httpsPort: number, timeoutMs?: number }} o
 * @returns {Promise<import('node:net').Server>}
 */
export function startHttpRedirect(o) {
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.setTimeout(o.timeoutMs ?? HEAD_TIMEOUT_MS, () => socket.destroy());
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('latin1');
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) {
        if (buf.length > MAX_HEAD_BYTES) socket.destroy();
        return;
      }
      socket.removeAllListeners('data');
      const head = end > MAX_HEAD_BYTES ? null : parseRequestHead(buf.slice(0, end));
      const to = head === null ? null : redirectTarget(head.host, head.path, o);
      if (to === null) socket.destroy();
      else
        socket.end(
          `HTTP/1.1 308 Permanent Redirect\r\nLocation: ${to}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
        );
    });
  });
  const close = server.close.bind(server);
  server.close = (cb) => {
    let called = false;
    close(() => {
      if (!called) {
        called = true;
        cb?.();
      }
    });
    for (const s of sockets) s.destroy();
    return server;
  };
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, o.host, () => resolve(server));
  });
}
