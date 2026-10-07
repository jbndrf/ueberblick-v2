/**
 * One HTTP(S) request to an address that was validated beforehand (A-033). The connection goes to `pinned.address`
 * through the `lookup` option, so the Host header and the TLS server name stay those of the URL's host. No redirect is
 * followed here (the guard does that, hop by hop); the body is read whole, up to a cap.
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface Pinned {
  readonly address: string;
  readonly family: 4 | 6;
}

export type Transport = (url: string, init: RequestInit, pinned: Pinned) => Promise<Response>;

/** The largest body read: a tile or a merged PMTiles range stays far below. */
const MAX_BODY = 16 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

export const pinnedTransport: Transport = (url, init, pinned) =>
  new Promise<Response>((resolve, reject) => {
    const u = new URL(url);
    const send = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const req = send(
      u,
      {
        method: init.method ?? 'GET',
        headers,
        timeout: TIMEOUT_MS,
        // Resolve to the validated address, whatever name the connection is made for.
        lookup: (_host, options, cb) => {
          const entry = { address: pinned.address, family: pinned.family };
          if ((options as { all?: boolean }).all === true)
            (cb as unknown as (e: null, a: unknown[]) => void)(null, [entry]);
          else cb(null, entry.address, entry.family);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY) req.destroy(new Error('the answer is too large'));
          else chunks.push(c);
        });
        res.on('error', reject);
        res.on('end', () => {
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers))
            if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : v);
          const status = res.statusCode ?? 502;
          const empty = status === 204 || status === 304 || (status >= 100 && status < 200);
          resolve(new Response(empty ? null : Buffer.concat(chunks), { status, headers: h }));
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('the upstream timed out')));
    req.on('error', reject);
    req.end();
  });
