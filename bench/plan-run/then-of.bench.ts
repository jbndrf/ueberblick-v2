/**
 * Budget (WP-374, A-035, docs/12 "Run endpoint"): a delete task whose `lifecycle: deleted, of: self.kinder`
 * step reaches 50 children plans in <= 10 ms in core. The children are read through the relation's edges,
 * never by scanning all features (the world holds 2k unrelated features to show it).
 * Run: npm run bench -- bench/plan-run
 */
import { describe, it } from 'vitest';
import { formApi } from '../../packages/core/src/form';
import type { Key, Run } from '../../packages/core/src/model';
import { compilePerms } from '../../packages/core/src/perms';
import { createPlan, oneVersion } from '../../packages/core/src/plan';
import { World, actor, build, fid, ports, rid } from '../../packages/core/src/plan/__fixtures__/world';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const plan = createPlan(formApi);
const boss = actor('participant', 'b', ['boss']);
const file = {
  schema: 'ueberblick/1',
  template: { key: 'of', version: '1.0.0' },
  roles: { boss: { label: 'Boss' } },
  types: {
    eltern: {
      label: 'Eltern',
      permissions: { see: '$all', create: '$all', write: '$all', delete: ['boss'] },
      properties: { name: { type: 'text' } },
      relations: { kinder: { to: 'kind', inverse_of: 'kind.eltern', cardinality: 'many' } },
    },
    kind: {
      label: 'Kind',
      permissions: { see: '$all', create: '$all', write: '$all', delete: ['boss'] },
      properties: { name: { type: 'text' }, eltern: { type: 'reference', to: 'eltern' } },
    },
  },
  tasks: {
    loeschen: {
      label: 'Löschen',
      on: 'eltern',
      then: [{ lifecycle: 'deleted', of: 'self.kinder' }, { lifecycle: 'deleted' }],
    },
  },
};

describe('plan: delete with 50 children (then-step of)', () => {
  it('plans in <= 10 ms next to 2k unrelated features', () => {
    const cfg = build(file);
    const w = new World(cfg);
    for (let k = 0; k < 2000; k++) w.add(fid(1000 + k), 'kind', { name: `x${k}` });
    for (let p = 0; p < 40; p++) w.add(fid(10 + p), 'eltern', { name: `p${p}` });
    for (let c = 0; c < 50; c++) w.add(fid(500 + c), 'kind', { name: `k${c}`, eltern: fid(10) });
    const perms = compilePerms(cfg);
    const ps = ports(w);
    let n = 0;
    const make = (): Run => ({
      id: rid(++n),
      task: 'loeschen' as Key,
      actor: boss,
      configVersion: 1,
      input: {},
      featureId: fid(10),
    });
    // The plan never writes to the world, so every call plans the same 51 observations.
    for (let i = 0; i < 5; i++) plan.planFor([make()], oneVersion(cfg, perms), ps);
    const batch = (): number => {
      const samples: number[] = [];
      for (let i = 0; i < 30; i++) {
        const r = make();
        const t0 = performance.now();
        const res = plan.planFor([r], oneVersion(cfg, perms), ps);
        samples.push(performance.now() - t0);
        if (!res.ok) throw new Error(res.refusal.message);
        if (res.runs[0]?.observations.length !== 51) throw new Error('expected 51 observations');
      }
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length / 2)] as number;
    };
    const medians = Array.from({ length: 5 }, batch).sort((a, b) => a - b);
    assertBudget(
      report(
        defineBudget({
          id: 'plan-run-then-of-50',
          limit: 10,
          unit: 'ms',
          derivedFrom: 'run-endpoint-p95: core planning share of the 50 ms endpoint budget',
          device: 'server',
        }),
        medians[2] as number,
      ),
    );
  });
});
