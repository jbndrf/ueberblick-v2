/**
 * Budget (WP-434, A-047, docs/12 "Run endpoint"): a run with 5 form fields `<bind>.<property>` of one bound Objekt
 * plans in <= 10 ms in core (the share of the 50 ms endpoint budget), next to 2k unrelated features.
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
const props = ['p1', 'p2', 'p3', 'p4', 'p5'];
const file = {
  schema: 'ueberblick/1',
  template: { key: 'bindfield', version: '1.0.0' },
  roles: { boss: { label: 'Boss' } },
  types: {
    person: {
      label: 'Person',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: Object.fromEntries(props.map((p) => [p, { type: 'text' }])),
    },
    baum: {
      label: 'Baum',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { art: { type: 'text' }, pruefer: { type: 'reference', to: 'person' } },
    },
  },
  tasks: {
    pruefen: {
      label: 'Prüfen',
      on: 'baum',
      bind: { pruefer: 'self.pruefer' },
      form: Object.fromEntries(props.map((p) => [`pruefer.${p}`, { constraint: "value != ''" }])),
    },
  },
};

describe('plan: a run with 5 bind fields', () => {
  it('plans in <= 10 ms next to 2k unrelated features', () => {
    const cfg = build(file);
    const w = new World(cfg);
    for (let k = 0; k < 2000; k++) w.add(fid(1000 + k), 'baum', { art: `x${k}` });
    w.add(fid(10), 'person', Object.fromEntries(props.map((p) => [p, 'alt'])));
    w.add(fid(11), 'baum', { art: 'Eiche', pruefer: fid(10) });
    const perms = compilePerms(cfg);
    const ps = ports(w);
    let n = 0;
    const make = (): Run => ({
      id: rid(++n),
      task: 'pruefen' as Key,
      actor: boss,
      configVersion: 1,
      input: Object.fromEntries(props.map((p) => [`pruefer.${p}`, `neu${n}`])),
      featureId: fid(11),
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
        if (res.runs[0]?.observations.length !== 5) throw new Error('expected 5 observations');
      }
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length / 2)] as number;
    };
    const medians = Array.from({ length: 5 }, batch).sort((a, b) => a - b);
    assertBudget(
      report(
        defineBudget({
          id: 'plan-run-bind-fields-5',
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
