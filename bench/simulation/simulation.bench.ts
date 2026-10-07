/**
 * Budget (WP-050): 1,000 seeded simulation scenarios (3 devices, 25 ticks, faults, offline periods, admin
 * batches) run in at most 60 s in CI. Every scenario must also satisfy the invariants.
 * Run: npm test -- -c bench/vitest.config.ts bench/simulation
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, baumWorkload, simulate } from '../../packages/core/src/testing';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

describe('simulation: 1,000 seeded scenarios', () => {
  it('run in at most 60 s and hold every invariant', () => {
    const workload = baumWorkload();
    const t0 = performance.now();
    let bad = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const r = simulate(workload, { ...DEFAULT_OPTIONS, seed, devices: 3, ticks: 25 });
      if (r.violations.length > 0) bad++;
    }
    const s = (performance.now() - t0) / 1000;
    assertBudget(
      report(
        defineBudget({
          id: 'simulation-1000',
          limit: 60,
          unit: 's',
          derivedFrom: 'run-endpoint-p95: WP-050 CI budget, 1,000 seeded scenarios in 60 s',
          device: 'server',
        }),
        s,
      ),
    );
    expect(bad).toBe(0);
  }, 120_000);
});
