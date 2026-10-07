/**
 * Budget (WP-513): the short simulation profile (real device adapters against the real SQLite and endpoint
 * handlers, `fixtures/golden/simulation/profiles.yaml`) runs in at most 30 s and holds every invariant, so it
 * can live in `npm run check`. The long profile (20 devices x 500 runs, 50 seeds) is `npm run sim`.
 * Run: npm test -- -c bench/vitest.config.ts bench/simulation-real
 */
import { describe, expect, it } from 'vitest';
import { baumWorkload } from '../../packages/core/src/testing';
import { simulateReal } from '../../packages/client/src/simulation/sim.testing';
import { sqliteBackend } from '../../fixtures/golden/simulation/backend';
import { optionsFor, REGRESSION_SEEDS, seedsOf } from '../../fixtures/golden/simulation/profiles';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

describe('simulation against the real adapters: short profile', () => {
  it('runs in at most 30 s and holds every invariant', async () => {
    const workload = baumWorkload();
    const seeds = [...new Set([...seedsOf('short'), ...REGRESSION_SEEDS])];
    const t0 = performance.now();
    let runs = 0;
    let bad = 0;
    for (const seed of seeds) {
      const r = await simulateReal(workload, sqliteBackend, optionsFor('short', seed));
      runs += r.stats.submitted;
      if (r.violations.length > 0) bad++;
    }
    const s = (performance.now() - t0) / 1000;
    assertBudget(
      report(
        defineBudget({
          id: 'simulation-real-short',
          limit: 30,
          unit: 's',
          derivedFrom: 'WP-513: the short profile in npm run check takes at most 30 s',
          device: 'server',
        }),
        s,
      ),
    );
    report(
      defineBudget({
        id: 'simulation-real-ms-per-run',
        limit: 200,
        unit: 'ms',
        derivedFrom:
          'WP-513: cost of one simulated run through store, queue, sync and SQLite; the long profile is 500,000 of them',
        device: 'server',
      }),
      (s * 1000) / runs,
    );
    expect(bad).toBe(0);
  }, 120_000);
});
