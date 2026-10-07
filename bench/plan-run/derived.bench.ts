/**
 * Budget (WP-041.2, docs/12 "Run endpoint"): a run whose derived relation meets 2k candidate features
 * (Facts.near returns them all) plans in <= 5 ms in core. The Facts here is the in-memory World of the
 * plan tests (a linear scan over 2k features stands in for the R*Tree).
 * Run: npm test -- -c bench/vitest.config.ts bench/plan-run
 */
import { describe, it } from 'vitest';
import { formApi } from '../../packages/core/src/form';
import type { Json, Key, Run } from '../../packages/core/src/model';
import { compilePerms } from '../../packages/core/src/perms';
import { createPlan, oneVersion } from '../../packages/core/src/plan';
import { inlineFile } from '../../packages/core/src/plan/__fixtures__/inline';
import { World, actor, build, fid, ports, rid } from '../../packages/core/src/plan/__fixtures__/world';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const plan = createPlan(formApi);
const maker = actor('participant', 'm', ['maker']);

/** Every 100th zone holds the point; the others are rings with a hole around it (bbox candidates, no edge). */
const box = (k: number): Json => {
  const d = 2 + k / 1000;
  const outer = [
    [0, 0],
    [d, 0],
    [d, d],
    [0, d],
    [0, 0],
  ];
  const hole = [
    [0.5, 0.5],
    [0.5, 1.5],
    [1.5, 1.5],
    [1.5, 0.5],
    [0.5, 0.5],
  ];
  return { type: 'Polygon', coordinates: k % 100 === 0 ? [outer] : [outer, hole] };
};

describe('plan: derived relation against 2k candidates', () => {
  it('creating an item inside 2k zones whose bbox holds the point (20 contain it) stays within 5 ms', () => {
    const cfg = build(inlineFile(3));
    const w = new World(cfg);
    for (let k = 0; k < 2000; k++) w.add(fid(100 + k), 'zone', { area: box(k) });
    const perms = compilePerms(cfg);
    const p = ports(w);
    let n = 0;
    const make = (): Run => ({
      id: rid(++n),
      task: 'add' as Key,
      actor: maker,
      configVersion: 1,
      input: { geom: { type: 'Point', coordinates: [1, 1] }, label: 'n' },
    });
    for (let i = 0; i < 5; i++) plan.planFor([make()], oneVersion(cfg, perms), p);
    // Median of 5 batches, each the median of 30 runs: one preempted batch (a loaded machine) cannot fail the budget.
    const batch = (): number => {
      const samples: number[] = [];
      for (let i = 0; i < 30; i++) {
        const r = make();
        const t0 = performance.now();
        const res = plan.planFor([r], oneVersion(cfg, perms), p);
        samples.push(performance.now() - t0);
        if (!res.ok) throw new Error(res.refusal.message);
      }
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length / 2)] as number;
    };
    const medians = Array.from({ length: 5 }, batch).sort((a, b) => a - b);
    const ms = medians[2] as number;
    assertBudget(
      report(
        defineBudget({
          id: 'plan-run-derived-2k',
          limit: 5,
          unit: 'ms',
          derivedFrom: 'run-endpoint-p95: core planning share of the 50 ms endpoint budget',
          device: 'server',
        }),
        ms,
      ),
    );
  });
});
