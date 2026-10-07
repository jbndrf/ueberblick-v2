export const LITESTREAM_VERSION: string;
export const LITESTREAM_SHA256: Record<string, string>;
export function releaseUrl(platform: string): string;
export function installHint(): string;
export function findLitestream(pathEnv?: string): string | null;
export function restoreReplica(
  binary: string,
  replicaUrl: string,
  outPath: string,
): { ok: boolean; message: string };
