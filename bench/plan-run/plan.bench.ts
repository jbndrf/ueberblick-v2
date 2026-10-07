/**
 * Budget (WP-041, docs/12 "Run endpoint"): planning one run including rules <= 5 ms in core (the endpoint's
 * 50 ms budget is end to end). Case A: `kontrolle` on a tree (form, bind, four then-steps, one rule run that
 * creates a measure). Case B: a plain `befund_ergaenzen`. Facts are the in-memory world of the plan tests.
 * Run: npm test -- -c bench/vitest.config.ts bench/plan-run
 */
import { describe, it } from 'vitest';
import { formApi } from '../../packages/core/src/form';
import type { Json, Key, Run } from '../../packages/core/src/model';
import { compilePerms } from '../../packages/core/src/perms';
import { createPlan, oneVersion } from '../../packages/core/src/plan';
import { IDS, anna, musterstadt, ports, rid } from '../../packages/core/src/plan/__fixtures__/world';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const plan = createPlan(formApi);
const { config, world } = musterstadt();
const perms = compilePerms(config);
const p = ports(world);

let n = 0;
const run = (task: string, input: Record<string, Json>): Run => ({
  id: rid(++n),
  task: task as Key,
  actor: anna,
  configVersion: 1,
  featureId: IDS.t_in,
  input,
});

function medianMs(make: () => Run, runs = 300, trace = false): number {
  for (let i = 0; i < 30; i++) plan.planFor([make()], oneVersion(config, perms), p, { trace }); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const r = make();
    const t0 = performance.now();
    const res = plan.planFor([r], oneVersion(config, perms), p, { trace });
    samples.push(performance.now() - t0);
    if (!res.ok) throw new Error(res.refusal.message);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] as number;
}

describe('plan: one run incl. rules', () => {
  it('kontrolle with a triggered rule run stays within 5 ms', () => {
    const ms = medianMs(() => run('kontrolle', { vitalitaet: 'v3', befund: 'Pilzbefall', hoehe_m: 18 }));
    assertBudget(
      report(
        defineBudget({
          id: 'plan-run-rules',
          limit: 5,
          unit: 'ms',
          derivedFrom: 'run-endpoint-p95: core planning share of the 50 ms endpoint budget',
          device: 'server',
        }),
        ms,
      ),
    );
  });
  it('a plain run stays within 5 ms', () => {
    const ms = medianMs(() => run('befund_ergaenzen', { befund: 'x' }));
    assertBudget(
      report(
        defineBudget({
          id: 'plan-run-plain',
          limit: 5,
          unit: 'ms',
          derivedFrom: 'run-endpoint-p95: core planning share of the 50 ms endpoint budget',
          device: 'server',
        }),
        ms,
      ),
    );
  });
  it('kontrolle with the rule trace on stays within 5 ms (cost of trace: compare with plan-run-rules)', () => {
    const ms = medianMs(
      () => run('kontrolle', { vitalitaet: 'v3', befund: 'Pilzbefall', hoehe_m: 18 }),
      300,
      true,
    );
    assertBudget(
      report(
        defineBudget({
          id: 'plan-run-rules-trace',
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
