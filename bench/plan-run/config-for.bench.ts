/**
 * Budget (WP-315, A-029; docs/12 "Run endpoint"): planning one run on the server, now through a per-version `configFor`
 * (`createConfigResolver` + `createVersionCache`). Case HIT: the version is in the cache (one pin lookup + a Map hit
 * per touched feature). Case MISS: the cache holds one version and two versions alternate, so every call reads the
 * stored form (JSON parse) and hydrates it, and compiles its permissions once. Both stay within the 5 ms core planning
 * share of the 50 ms endpoint budget; the numbers are shown separately.
 * Run: npm test -- -c bench/vitest.config.ts bench/plan-run/config-for
 */
import { describe, it } from 'vitest';
import { formApi } from '../../packages/core/src/form';
import type { Json, Key, Run } from '../../packages/core/src/model';
import type { ConfigFor } from '../../packages/core/src/plan';
import { createPlan } from '../../packages/core/src/plan';
import { IDS, anna, musterstadt, ports, rid } from '../../packages/core/src/plan/__fixtures__/world';
import { hydrate, serialize } from '../../packages/core/src/schema/compile/hydrate';
import { openProjectDb } from '../../packages/server/src/db/open';
import { createConfigResolver, createVersionCache } from '../../packages/server/src/store/run/config-for';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

const plan = createPlan(formApi);
const { config, world } = musterstadt();
const stored = JSON.stringify(serialize(config)); // what `config_versions.compiled` holds
const loadStored = (): ReturnType<typeof hydrate> => hydrate(JSON.parse(stored));
const p = ports(world);

const db = openProjectDb(':memory:', 'bench');
db.prepare(
  "INSERT INTO features (id, type, config_version, properties, updated_seq) VALUES (?, 'baum', 1, '{}', 1)",
).run(IDS.t_in);
db.prepare('UPDATE features SET pinned_version = 1 WHERE id = ?').run(IDS.t_in);

let n = 0;
const run = (): Run => ({
  id: rid(++n),
  task: 'kontrolle' as Key,
  actor: anna,
  configVersion: 1,
  featureId: IDS.t_in,
  input: { vitalitaet: 'v3', befund: 'Pilzbefall', hoehe_m: 18 } as Record<string, Json>,
});

function medianMs(configForOf: (i: number) => ConfigFor, runs = 200): number {
  for (let i = 0; i < 100; i++) plan.planFor([run()], configForOf(i), p); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const r = run();
    const configFor = configForOf(i);
    const t0 = performance.now();
    const res = plan.planFor([r], configFor, p);
    samples.push(performance.now() - t0);
    if (!res.ok) throw new Error(res.refusal.message);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] as number;
}

const budget = (id: string) =>
  defineBudget({
    id,
    limit: 5,
    unit: 'ms',
    derivedFrom: 'run-endpoint-p95: core planning share of the 50 ms endpoint budget',
    device: 'server',
  });

describe('plan through the server configFor', () => {
  it('cache hit: the pinned version is cached', () => {
    const resolver = createConfigResolver(
      db,
      createVersionCache(() => loadStored(), 8),
    );
    const ms = medianMs(() => resolver.configFor(1));
    console.info(`plan-configfor-hit median ${ms.toFixed(3)} ms`);
    assertBudget(report(budget('plan-configfor-hit'), ms));
  });

  it('cache miss: every call reads the stored form, hydrates it and compiles its permissions', () => {
    // a cache of one version, alternating two others: the pin (1) is never in the cache when the plan resolves it
    const resolver = createConfigResolver(
      db,
      createVersionCache(() => loadStored(), 1),
    );
    const ms = medianMs((i) => {
      resolver.at(2 + (i % 2));
      return resolver.configFor(2);
    });
    console.info(
      `plan-configfor-miss median ${ms.toFixed(3)} ms (includes the version read + hydrate + perms)`,
    );
    assertBudget(report(budget('plan-configfor-miss'), ms));
  });
});
