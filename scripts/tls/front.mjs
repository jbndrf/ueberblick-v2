// The TLS front of HTTPS_MODE=direct (WP-941). One small Node process in the app's container:
//
//   node scripts/tls/front.mjs node build/index.js
//
// It makes the certificates (cert.mjs, in `$DATA_DIR/tls`), listens for HTTPS on 8443 inside the container
// (compose publishes `${HTTPS_PORT}:8443`), forwards every request to the app on loopback with X-Forwarded-*, then
// starts the given command (the app) and ends when it ends. The app sees the front as a loopback client, so it trusts
// the forwarded headers from loopback and from nowhere else. Why not Caddy: `tls internal` would own the CA, and the
// setup page, the SAN rule and the reissue rule would then live in two places.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:https';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTlsMaterial } from './cert.mjs';
import { startHttpRedirect } from './redirect.mjs';

export const INTERNAL_HTTPS_PORT = 8443;
/** Where the plain-http redirect listens inside the container (compose publishes `${HTTP_PORT}:8080`, WP-964). */
export const INTERNAL_HTTP_PORT = 8080;

/** `192.168.1.20:8443` or `[fd00::5]:8443` to the lower-case host part. */
const hostName = (host = '') =>
  (host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.replace(/:\d+$/, '')).toLowerCase();

/**
 * Starts the HTTPS listener. Requests and responses are streamed (event streams, uploads). With `allowedHosts`
 * (LOCAL_HOSTS) a request for any other host name is answered 421, because the app takes its origin from the host the
 * front reports (WP-954, origin.mjs).
 * @param {{ key: string, cert: string }} tls
 * @param {{ host: string, port: number, upstreamPort: number, allowedHosts?: readonly string[] }} o
 * @returns {Promise<import('node:https').Server>}
 */
export function startTlsFront(tls, o) {
  const allowed = o.allowedHosts?.map((h) => h.toLowerCase());
  const server = createServer(tls, (req, res) => {
    if (allowed !== undefined && allowed.length > 0 && !allowed.includes(hostName(req.headers.host))) {
      res.writeHead(421, { 'content-type': 'text/plain' });
      res.end('this address is not one of LOCAL_HOSTS');
      return;
    }
    const up = httpRequest(
      {
        host: '127.0.0.1',
        port: o.upstreamPort,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          'x-forwarded-proto': 'https',
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
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('the app is not reachable yet');
    });
    res.on('close', () => up.destroy()); // an event stream ends when the browser leaves
    req.pipe(up);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, o.host, () => resolve(server));
  });
}

const DAY = 86_400_000;

/**
 * Keeps the certificate of a running front current, so a container that never restarts still serves a valid
 * certificate (the server certificate is valid 397 days; `loadTlsMaterial` reissues it when less than
 * RENEW_BEFORE_DAYS, cert.mjs, are left). On a change the front hot-swaps the certificate with `setSecureContext`
 * (new connections use it) and rotates the session ticket keys, so a client that holds a pre-swap session cannot
 * resume it and keep seeing the old certificate. No restart, and the CA is never reissued, so devices keep
 * trusting it; a failed check keeps the old certificate serving.
 *
 * @param {import('node:https').Server} server the running front
 * @param {{ dir: string, hosts: readonly string[], clock?: () => Date, intervalMs?: number }} o
 * @returns {() => void} stops the timer
 */
export function startRenewal(server, o) {
  const clock = o.clock ?? (() => new Date());
  const check = () => {
    try {
      const m = loadTlsMaterial({ dir: o.dir, hosts: o.hosts, now: clock() });
      if (m.created.server) {
        server.setSecureContext({ key: m.server.keyPem, cert: m.server.certPem });
        server.setTicketKeys(randomBytes(48)); // invalidate the pre-swap sessions, so every new connection re-handshakes
      }
    } catch (err) {
      console.error(
        'certificate renewal failed, the current certificate keeps serving:',
        err instanceof Error ? err.message : err,
      );
    }
  };
  check();
  const timer = setInterval(check, o.intervalMs ?? DAY);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Reads the settings the compose file passes (LOCAL_HOSTS, DATA_DIR, PORT, HTTPS_PORT, HTTP_PORT) and starts the TLS
 * front and, unless HTTP_PORT=0, the plain-http redirect. This file is plain .mjs and cannot import the config
 * module (TypeScript), so it reads these few variables itself; the config module validates them when the app starts,
 * and an empty value counts as unset in both (WP-964).
 * @param {Record<string, string | undefined>} env
 * @param {{ host?: string, httpsPort?: number, httpPort?: number }} [listen] where to listen (tests use port 0)
 */
export async function startFrontFromEnv(env, listen = {}) {
  const read = (name, fallback) => {
    const v = env[name]?.trim();
    return v === undefined || v === '' ? fallback : Number(v);
  };
  const hosts = (env.LOCAL_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h !== '');
  const host = listen.host ?? '0.0.0.0';
  const dir = join(env.DATA_DIR ?? './data', 'tls');
  const material = loadTlsMaterial({ dir, hosts });
  const front = await startTlsFront(
    { key: material.server.keyPem, cert: material.server.certPem },
    {
      host,
      port: listen.httpsPort ?? INTERNAL_HTTPS_PORT,
      upstreamPort: read('PORT', 3000),
      allowedHosts: hosts,
    },
  );
  const stopRenewal = startRenewal(front, { dir, hosts });
  // HTTPS_PORT is the published port (the address people open); HTTP_PORT=0 turns the redirect off.
  const httpPort = read('HTTP_PORT', 8080);
  const redirect =
    httpPort === 0
      ? null
      : await startHttpRedirect({
          host,
          port: listen.httpPort ?? INTERNAL_HTTP_PORT,
          hosts,
          httpsPort: read('HTTPS_PORT', 8443),
        });
  return { front, redirect, stopRenewal };
}

/** Runs the front plus the app command. */
async function main(command) {
  await startFrontFromEnv(process.env);
  const [cmd, ...args] = command;
  if (cmd === undefined) throw new Error('front.mjs needs the app command: front.mjs node build/index.js');
  const child = spawn(cmd, args, { stdio: 'inherit' });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code, signal) => process.exit(code ?? (signal === null ? 1 : 0)));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
}
