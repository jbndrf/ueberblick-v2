import type { FeatureId, Instant, RunId } from '../model';
import type { Clock, Ids } from '../ports';

const uuid = (source: number, n: number): string =>
  `${source.toString(16).padStart(8, '0')}-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

/** Deterministic UUIDv7-shaped ids. `source` tells the minters apart (a device, the server), so they never collide. */
export function createIds(source: number): Ids {
  let n = 0;
  return {
    runId: () => uuid(source, ++n) as RunId,
    featureId: () => uuid(source, 0x100000 + ++n) as FeatureId,
  };
}

/** A clock the simulation moves by hand. */
export interface FakeClock extends Clock {
  set(iso: Instant): void;
  /** Advance by milliseconds. */
  advance(ms: number): void;
}

export function createClock(start: Instant): FakeClock {
  let t = Date.parse(start);
  return {
    now: () => new Date(t).toISOString(),
    set: (iso) => {
      t = Date.parse(iso);
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

/** The run id every seeded (imported) observation carries; seeds bypass tasks like a restored backup. */
export const SEED_RUN = '00000000-0000-7000-8000-000000000000' as RunId;

/** The config version every simulated run is stamped with, and the version test stores fold under. */
export const SIM_CONFIG_VERSION = 1;
