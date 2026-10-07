/** Ids minted on the device (F1): UUIDv7, also the idempotency key of a run (F3). The random source is a port. */
import type { FeatureId, RunId } from '@ueberblick/core/model';
import type { Clock, Ids } from '@ueberblick/core/ports';

export type RandomBytes = (n: number) => Uint8Array;

/** A UUIDv7 (RFC 9562): 48-bit millisecond timestamp, version, 74 random bits, variant. */
export function uuidv7(ms: number, random: RandomBytes): string {
  const b = random(16).slice();
  let t = ms;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = ((b[6] as number) & 0x0f) | 0x70;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createDeviceIds(clock: Clock, random: RandomBytes): Ids {
  const mint = (): string => uuidv7(Date.parse(clock.now()), random);
  return { runId: () => mint() as RunId, featureId: () => mint() as FeatureId };
}
