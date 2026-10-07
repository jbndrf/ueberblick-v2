import type { Server } from 'node:https';
import type { Server as NetServer } from 'node:net';

export const INTERNAL_HTTPS_PORT: number;
export const INTERNAL_HTTP_PORT: number;
export function startTlsFront(
  tls: { key: string; cert: string },
  options: { host: string; port: number; upstreamPort: number; allowedHosts?: readonly string[] },
): Promise<Server>;

/**
 * Keeps the running front's server certificate current: checks once (and then every `intervalMs`, default once a
 * day) through `loadTlsMaterial`, and on a reissue hot-swaps it with `server.setSecureContext` — no restart, the CA
 * is unchanged. Returns a stop function.
 */
export function startRenewal(
  server: Server,
  options: { dir: string; hosts: readonly string[]; clock?: () => Date; intervalMs?: number },
): () => void;

/** Starts the TLS front and (unless HTTP_PORT=0) the plain-http redirect from the environment variables of the container. */
export function startFrontFromEnv(
  env: Record<string, string | undefined>,
  listen?: { host?: string; httpsPort?: number; httpPort?: number },
): Promise<{ front: Server; redirect: NetServer | null; stopRenewal: () => void }>;
