import type { Server } from 'node:net';

export const MAX_HEAD_BYTES: number;
export const HEAD_TIMEOUT_MS: number;
export function redirectTarget(
  hostHeader: string | undefined,
  path: string | undefined,
  options: { hosts: readonly string[]; httpsPort: number },
): string | null;
export function parseRequestHead(head: string): { path: string; host: string | undefined } | null;
export function startHttpRedirect(options: {
  host: string;
  port: number;
  hosts: readonly string[];
  httpsPort: number;
  timeoutMs?: number;
}): Promise<Server>;
