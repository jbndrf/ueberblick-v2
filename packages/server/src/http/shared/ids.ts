import { randomBytes } from 'node:crypto';
import type { Clock, FeatureId, Ids, RunId } from '@ueberblick/core';

/** A UUIDv7 (RFC 9562): 48-bit millisecond timestamp, version, 74 random bits, variant. */
export function uuidv7(ms: number): string {
  const b = randomBytes(16);
  b.writeUIntBE(ms, 0, 6);
  b[6] = ((b[6] as number) & 0x0f) | 0x70;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The server's id minter (rule runs, features created by rules). */
export function createServerIds(clock: Clock): Ids {
  const mint = (): string => uuidv7(Date.parse(clock.now()));
  return { runId: () => mint() as RunId, featureId: () => mint() as FeatureId };
}
