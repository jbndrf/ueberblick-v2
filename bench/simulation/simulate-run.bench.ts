/**
 * Budget (WP-202, docs/12 "Run endpoint"): simulating one run, a three-run rule chain (submit + 2 rule runs),
 * <= 50 ms (median of 30). Moved from the unit spec (WP-147).
 * Run: npm test -- -c bench/vitest.config.ts bench/simulation
 */
import { describe, expect, it } from 'vitest';
import type { FeatureId, Key } from '../../packages/core/src';
import { actorOf, loadScenario } from '../../packages/builder/src/simulate/scenario-runner';
import { defineBudget, report } from '../harness/budget.mjs';

describe('simulate one run', () => {
  it('a three-run rule chain in <= 50 ms (median of 30)', () => {
    const w = loadScenario('rules/rule_chain_completes');
    const [id] = w.sim.seed([
      {
        type: 'meldung' as Key,
        properties: {
          geometrie: { type: 'Point', coordinates: [7.1, 50.75] },
          status: 'offen',
          prioritaet: 'hoch',
          kategorie: 'strasse',
          beschreibung: { de: 'Loch' },
        },
      },
    ]);
    const run = {
      task: 'bewerten' as Key,
      actor: actorOf(w, 'sabine'),
      feature: id as FeatureId,
      input: { prioritaet: 'hoch' },
    };
    w.sim.submit(run, { commit: false }); // warm-up: JIT and the geometry engine
    const samples: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const t0 = performance.now();
      const r = w.sim.submit(run, { commit: false });
      samples.push(performance.now() - t0);
      expect(r.ok).toBe(true);
    }
    samples.sort((a, b) => a - b);
    const median = samples[15] as number;
    console.info(`simulate-run chain=3: ${median.toFixed(2)} ms median`);
    report(
      defineBudget({
        id: 'simulate-run-chain',
        limit: 50,
        unit: 'ms',
        derivedFrom: 'run-endpoint-p95: one run including rules; the builder simulator runs the same plan',
        device: 'dev-only',
        thread: 'main',
      }),
      Number(median.toFixed(2)),
    );
  });
});
