/**
 * Budget (WP-312, docs/12 "Run endpoint"): a run on a type with 5 computed properties that all read the changed input
 * plans in <= 5 ms in core (the same share as a derived relation, bench/plan-run/derived.bench.ts); a run that changes
 * an unrelated property evaluates nothing (O(changed keys)) and is reported next to it.
 * Run: npm test -- -c bench/vitest.config.ts bench/plan-run/computed
 */
import { describe, it } from 'vitest';
import { formApi } from '../../packages/core/src/form';
import type { Json, Key, Run } from '../../packages/core/src/model';
import { compilePerms } from '../../packages/core/src/perms';
import { createPlan, oneVersion } from '../../packages/core/src/plan';
import { World, actor, build, fid, ports, rid } from '../../packages/core/src/plan/__fixtures__/world';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const plan = createPlan(formApi);
const maker = actor('participant', 'm', ['maker']);
const ID = fid(1);

const file = {
  schema: 'ueberblick/1',
  template: { key: 'bench', version: '1.0.0' },
  roles: { maker: { label: 'Maker' } },
  types: {
    item: {
      label: 'Item',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: {
        n: { type: 'integer' },
        note: { type: 'text' },
        c1: { type: 'integer', computed: 'self.n + 1' },
        c2: { type: 'integer', computed: 'self.c1 * 2' },
        c3: { type: 'integer', computed: 'self.c2 + self.n' },
        c4: { type: 'text', computed: "self.c3 > 10 ? 'big' : 'small'" },
        c5: { type: 'boolean', computed: 'self.c3 % 2 == 0' },
      },
    },
  },
  tasks: { edit: { label: 'Edit', on: 'item', form: { n: {}, note: {} } } },
};

/** Median of 5 batches, each the median of 30 runs, so one preempted batch cannot fail the budget. */
function median(input: (i: number) => Record<string, Json>): number {
  const cfg = build(file);
  const w = new World(cfg);
  w.add(ID, 'item', { n: 0 });
  const perms = compilePerms(cfg);
  const p = ports(w);
  let n = 0;
  const make = (i: number): Run => ({
    id: rid(++n),
    task: 'edit' as Key,
    actor: maker,
    configVersion: 1,
    featureId: ID,
    input: input(i),
  });
  for (let i = 0; i < 5; i++) plan.planFor([make(i)], oneVersion(cfg, perms), p);
  const batch = (): number => {
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const r = make(i + 100);
      const t0 = performance.now();
      const res = plan.planFor([r], oneVersion(cfg, perms), p);
      samples.push(performance.now() - t0);
      if (!res.ok) throw new Error(res.refusal.message);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)] as number;
  };
  const medians = Array.from({ length: 5 }, batch).sort((a, b) => a - b);
  return medians[2] as number;
}

describe('plan: computed properties', () => {
  it('a run changing the input of 5 computed properties stays within 5 ms', () => {
    const ms = median((i) => ({ n: i }));
    assertBudget(
      report(
        defineBudget({
          id: 'plan-run-computed-5',
          limit: 5,
          unit: 'ms',
          derivedFrom: 'run-endpoint-p95: core planning share of the 50 ms endpoint budget',
          device: 'server',
        }),
        ms,
      ),
    );
  });

  it('a run changing an unrelated property evaluates nothing and stays within 5 ms', () => {
    const ms = median((i) => ({ note: `n${i}` }));
    assertBudget(
      report(
        defineBudget({
          id: 'plan-run-computed-untouched',
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
