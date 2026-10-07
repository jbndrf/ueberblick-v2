// WP-579: the default geometry engine loads lazily, once, and a failed load does not stick.
import { createGeo } from '@ueberblick/core/geo';
import type { Geo } from '@ueberblick/core/geo';
import type { Run } from '@ueberblick/core/model';
import { describe, expect, it } from 'vitest';
import type { RunQueueDeps } from './contract';
import { createPlanner } from './planner';

const STOP = new Error('stop after the engine');

/** Deps that let `plan()` get past the engine and then stop at the store, so only the engine is exercised. */
function deps(geo?: Geo): RunQueueDeps {
  return {
    store: { warmHistory: () => Promise.reject(STOP), facts: { edgesFrom: () => [], edgesTo: () => [] } },
    config: { get: () => ({}) },
    clock: { now: () => '2026-05-01T08:00:00.000Z' },
    ...(geo ? { geo } : {}),
  } as unknown as RunQueueDeps;
}
const run = { configVersion: 1 } as unknown as Run;

describe('planner lazy geo engine', () => {
  it('two concurrent first plans create one engine', async () => {
    let loads = 0;
    const planner = createPlanner(deps(), () => {
      loads++;
      return Promise.resolve(createGeo());
    });
    await Promise.all([planner.plan([run]).catch((e) => e), planner.plan([run]).catch((e) => e)]);
    expect(loads).toBe(1);
    await planner.plan([run]).catch((e) => e);
    expect(loads).toBe(1);
  });

  it('an injected geo wins: the loader is never called', async () => {
    let loads = 0;
    const planner = createPlanner(deps(createGeo()), () => {
      loads++;
      return Promise.resolve(createGeo());
    });
    await planner.plan([run]).catch((e) => e);
    expect(loads).toBe(0);
  });

  it('a failed load is retried by the next plan', async () => {
    let loads = 0;
    const planner = createPlanner(deps(), () => {
      loads++;
      return loads === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(createGeo());
    });
    await expect(planner.plan([run])).rejects.toThrow('offline');
    await expect(planner.plan([run])).rejects.toBe(STOP); // the engine loaded this time, the store then stopped it
    expect(loads).toBe(2);
  });
});
