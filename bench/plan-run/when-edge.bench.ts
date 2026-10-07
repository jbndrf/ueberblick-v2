/**
 * Budget (WP-427, A-045, docs/12 "Run endpoint"): a run that touches 50 features, with 5 `{ when }` rules in the
 * file, plans in <= 10 ms in core. Only the touched features are judged, before and after the run; the world
 * holds 2k unrelated features to show that nothing scans them.
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
  template: { key: 'we', version: '1.0.0' },
  roles: { boss: { label: 'Boss' } },
  types: {
    eltern: {
      label: 'Eltern',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { name: { type: 'text' } },
      relations: { kinder: { to: 'kind', inverse_of: 'kind.eltern', cardinality: 'many' } },
    },
    kind: {
      label: 'Kind',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: {
        name: { type: 'text' },
        n: { type: 'number', default: 0 },
        eltern: { type: 'reference', to: 'eltern' },
      },
    },
  },
  tasks: {
    setzen: { label: 'Setzen', on: 'eltern', then: [{ set: { n: '20' }, of: 'self.kinder' }] },
    melden: {
      label: 'Melden',
      on: 'kind',
      auto: Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`ab_${i}`, { when: `self.n > ${i * 3}` }])),
    },
  },
};

describe('plan: a run touching 50 features with 5 `when` rules', () => {
  it('plans in <= 10 ms next to 2k unrelated features', () => {
    const cfg = build(file);
    const w = new World(cfg);
    for (let k = 0; k < 2000; k++) w.add(fid(1000 + k), 'kind', { name: `x${k}` });
    w.add(fid(10), 'eltern', { name: 'p' });
    for (let c = 0; c < 50; c++) w.add(fid(500 + c), 'kind', { name: `k${c}`, eltern: fid(10), n: 0 });
    const perms = compilePerms(cfg);
    const ps = ports(w);
    let n = 0;
    const make = (): Run => ({
      id: rid(++n),
      task: 'setzen' as Key,
      actor: boss,
      configVersion: 1,
      input: {},
      featureId: fid(10),
    });
    for (let i = 0; i < 5; i++) plan.planFor([make()], oneVersion(cfg, perms), ps);
    const batch = (): number => {
      const samples: number[] = [];
      for (let i = 0; i < 30; i++) {
        const r = make();
        const t0 = performance.now();
        const res = plan.planFor([r], oneVersion(cfg, perms), ps);
        samples.push(performance.now() - t0);
        if (!res.ok) throw new Error(res.refusal.message);
        // 50 features cross 5 thresholds: 250 rule runs follow the submitted run.
        if (res.runs.filter((x) => x.rule !== undefined).length !== 250) throw new Error('expected 250 rule runs');
      }
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length / 2)] as number;
    };
    const medians = Array.from({ length: 5 }, batch).sort((a, b) => a - b);
    assertBudget(
      report(
        defineBudget({
          id: 'plan-run-when-edge-50x5',
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
