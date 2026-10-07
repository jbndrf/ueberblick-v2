// WP-050: the simulator's invariants, seed reproducibility and the H2 admin batch.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, baumWorkload, simulate, type SimOptions } from './index';
import { createRng } from './prng';

const workload = baumWorkload();
const opts = (seed: number, over: Partial<SimOptions> = {}): SimOptions => ({
  ...DEFAULT_OPTIONS,
  seed,
  ...over,
});

/** Seeds that once left an accepted run in the queue: its answer arrived after the page that carried it. */
const REGRESSION_SEEDS = [119046777, 1124795040, 1518783037];

describe('simulator invariants', () => {
  it('regression: a delayed accept answer is applied before quiescence is judged', () => {
    for (const seed of REGRESSION_SEEDS) {
      const r = simulate(
        workload,
        opts(seed, { devices: 1, faults: { drop: 0, duplicate: 0, maxDelay: 2 } }),
      );
      expect(r.violations, `seed ${seed}`).toEqual([]);
    }
  });

  // One small unit of work per seed (WP-575): each test fits the timeout with a wide margin under load.
  const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

  it.each(SEEDS)('holds with faults, offline periods and restarts: seed %i of 40', (seed) => {
    const r = simulate(workload, opts(seed));
    expect(r.violations, `seed ${seed}`).toEqual([]);
  });

  // 5 bands x 5 runs = the former 25 runs. Each band draws its own cases; SIM_RUNS_FACTOR runs each longer.
  it.each([0, 1, 2, 3, 4])(
    'property band %i: convergence, no accepted run lost and no trace of refusals for any seed and any fault mix',
    (band) => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 2 ** 31 }),
          fc.integer({ min: 1, max: 5 }),
          fc.double({ min: 0, max: 0.5, noNaN: true }),
          fc.double({ min: 0, max: 0.5, noNaN: true }),
          fc.integer({ min: 0, max: 8 }),
          (seed, devices, drop, duplicate, maxDelay) => {
            const r = simulate(workload, opts(seed, { devices, faults: { drop, duplicate, maxDelay } }));
            expect(r.violations, `seed ${seed}`).toEqual([]);
          },
        ),
        {
          // SIM_RUNS_FACTOR=50 runs the property 50 times longer (the loop evidence in the WP log).
          numRuns: 5 * Number(process.env['SIM_RUNS_FACTOR'] ?? 1),
          // The regression examples run in band 0 only.
          examples:
            band === 0
              ? REGRESSION_SEEDS.map((seed) => [seed, 1, 0, 0, 2] as [number, number, number, number, number])
              : [],
        },
      );
    },
    600_000,
  );

  // 10 self-contained bands of 4 seeds (seeds 1..40). Each band asserts its own thresholds; the sum over
  // the bands is at least the former claim (accepted > 50 over 40 seeds: 10 x 5 gives >= 60 already).
  it.each(Array.from({ length: 10 }, (_, i) => i))(
    'exercises what it claims: accepted runs, device refusals and admin batches happen: band %i (4 seeds)',
    (band) => {
      const total = { accepted: 0, refusedOnDevice: 0, adminBatches: 0 };
      for (let seed = band * 4 + 1; seed <= band * 4 + 4; seed++) {
        const s = simulate(workload, opts(seed, { ticks: 60, adminRate: 0.15 })).stats;
        total.accepted += s.accepted;
        total.refusedOnDevice += s.refusedOnDevice;
        total.adminBatches += s.adminBatches;
      }
      expect(total.accepted).toBeGreaterThan(5);
      expect(total.refusedOnDevice).toBeGreaterThan(0);
      expect(total.adminBatches).toBeGreaterThan(0);
    },
  );
});

describe('a failing seed is reproducible from its number', () => {
  it('the same seed gives the identical run', () => {
    const a = simulate(workload, opts(1234));
    const b = simulate(workload, opts(1234));
    expect(b).toEqual(a);
  });

  it('different seeds differ', () => {
    const digests = new Set(Array.from({ length: 10 }, (_, i) => simulate(workload, opts(i + 1)).digest));
    expect(digests.size).toBeGreaterThan(5);
  });

  it('the rng is a pure function of its seed', () => {
    const a = createRng(7);
    const b = createRng(7);
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(Array.from({ length: 20 }, () => b.next()));
  });
});

describe('H2: an admin injects batch runs while devices are offline', () => {
  it('batches land on the server, devices converge when they return', () => {
    const r = simulate(workload, opts(5, { offlineFlip: 0.9, adminRate: 0.6, ticks: 30 }));
    expect(r.stats.adminBatches).toBeGreaterThan(3);
    expect(r.violations).toEqual([]);
  });
});
