/**
 * The long profile (`npm run sim`): 50 seeds of 20 devices x 500 runs against the real adapters, spread over
 * ten spec files so vitest runs them in parallel processes. Skipped unless `SIM` is set, so `npm run check`
 * only runs the short profile. `SIM_SEED` (with the other `SIM_*` variables of a printed reproduction) runs
 * exactly that one simulation.
 */
import { describe, expect, it } from 'vitest';
import { baumWorkload } from '../../../packages/core/src/testing';
import { failWithRepro, fromEnv } from '../../../packages/client/src/simulation/repro.testing';
import { simulateReal } from '../../../packages/client/src/simulation/sim.testing';
import type { RealSimOptions } from '../../../packages/client/src/simulation/contract.testing';
import { sqliteBackend } from './backend';
import { optionsFor, seedsOf } from './profiles';

export const SHARDS = 10;
const LONG_TIMEOUT_MS = 30 * 60_000;

export function longShard(index: number): void {
  const enabled = process.env['SIM'] !== undefined;
  const workload = baumWorkload();
  const single = process.env['SIM_SEED'] !== undefined;
  const seeds = single
    ? index === 0
      ? [Number(process.env['SIM_SEED'])]
      : []
    : seedsOf('long').filter((s) => s % SHARDS === index);
  describe.skipIf(!enabled)(`long profile, shard ${index + 1} of ${SHARDS}`, () => {
    it.each(seeds)(
      'seed %i holds every invariant',
      async (seed) => {
        const options = fromEnv(optionsFor('long', seed), process.env);
        const run = (o: RealSimOptions) => simulateReal(workload, sqliteBackend, o);
        const report = await run(options);
        await failWithRepro(run, report);
        expect(report.violations).toEqual([]);
      },
      LONG_TIMEOUT_MS,
    );
  });
}
